// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title InvoiceVault
/// @notice OneClick Checkout invoices paid directly from payer to merchant and fee recipient.
/// @dev Amounts are USDC base units (6 decimals on Arc). No native currency is accepted.
///      On Arc, deploy with USDC at 0x3600000000000000000000000000000000000000.
contract InvoiceVault is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice Maximum fee in basis points (2%).
    uint16 public constant MAX_FEE_BPS = 200;
    /// @notice Maximum UTF-8 memo size in bytes.
    uint256 public constant MAX_MEMO_LENGTH = 140;

    /// @notice Token used for all payments.
    IERC20 public immutable usdc;
    /// @notice Address receiving fees on subsequent payments.
    address public feeRecipient;
    /// @notice Deployment-fixed fee in basis points.
    uint16 public immutable feeBps;
    /// @dev ID assigned to the next invoice; IDs start at one.
    uint256 private nextInvoiceId = 1;

    /// @notice Computed invoice status, in ABI order.
    enum Status { Unpaid, Paid, Cancelled, Expired }

    /// @notice Invoice details; paidAt != 0 denotes a paid invoice.
    struct Invoice {
        address merchant;
        address payer;
        uint256 amount;
        uint64 expiresAt;
        uint64 createdAt;
        uint64 paidAt;
        bool cancelled;
        string memo;
    }

    /// @notice Public invoice details with its ID and computed status.
    struct InvoiceView {
        uint256 id;
        address merchant;
        address payer;
        uint256 amount;
        string memo;
        uint64 createdAt;
        uint64 expiresAt;
        uint64 paidAt;
        Status status;
    }

    mapping(uint256 => Invoice) private _invoices;
    mapping(address => uint256[]) private _merchantInvoices;

    error ZeroAddress();
    error FeeTooHigh(uint16 feeBps);
    error InvalidAmount();
    error InvalidExpiry(uint64 expiresAt);
    error MemoTooLong(uint256 length);
    error InvoiceNotFound(uint256 invoiceId);
    error InvoiceAlreadyPaid(uint256 invoiceId);
    error InvoiceAlreadyCancelled(uint256 invoiceId);
    error InvoiceExpired(uint256 invoiceId);
    error NotMerchant(uint256 invoiceId);
    error RenounceDisabled();

    event InvoiceCreated(
        uint256 indexed id,
        address indexed merchant,
        uint256 amount,
        string memo,
        uint64 expiresAt
    );
    event InvoicePaid(
        uint256 indexed id,
        address indexed merchant,
        address indexed payer,
        uint256 amount,
        uint256 fee
    );
    event InvoiceCancelled(uint256 indexed id);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    /// @notice Initialize the vault with the deployer as owner.
    /// @param usdc_ USDC token address (a mock may be supplied in tests); must be nonzero.
    /// @param feeRecipient_ Initial fee recipient; must be nonzero.
    /// @param feeBps_ Fixed fee, capped at 200 basis points; use 100 for 1%.
    constructor(address usdc_, address feeRecipient_, uint16 feeBps_)
        Ownable(msg.sender)
    {
        if (usdc_ == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        if (feeBps_ > MAX_FEE_BPS) revert FeeTooHigh(feeBps_);
        usdc = IERC20(usdc_);
        feeRecipient = feeRecipient_;
        feeBps = feeBps_;
    }

    /// @notice Create an invoice belonging to the caller.
    /// @param amount Total USDC base units charged to the payer, including fees.
    /// @param memo Invoice description, limited to 140 bytes.
    /// @param expiresAt Expiry timestamp, or zero for no expiry.
    /// @return invoiceId Newly assigned sequential ID.
    function createInvoice(uint256 amount, string calldata memo, uint64 expiresAt)
        external
        returns (uint256 invoiceId)
    {
        if (amount == 0) revert InvalidAmount();
        if (expiresAt != 0 && expiresAt <= block.timestamp) revert InvalidExpiry(expiresAt);
        if (bytes(memo).length > MAX_MEMO_LENGTH) revert MemoTooLong(bytes(memo).length);

        invoiceId = nextInvoiceId++;
        _invoices[invoiceId] = Invoice({
            merchant: msg.sender,
            payer: address(0),
            amount: amount,
            expiresAt: expiresAt,
            createdAt: uint64(block.timestamp),
            paidAt: 0,
            cancelled: false,
            memo: memo
        });
        _merchantInvoices[msg.sender].push(invoiceId);
        emit InvoiceCreated(invoiceId, msg.sender, amount, memo, expiresAt);
    }

    /// @notice Pay an open invoice using an allowance covering its full amount.
    /// @dev Payment at exactly expiresAt is allowed. Both transfers are atomic;
    ///      funds go directly to recipients and never pass through this contract.
    function payInvoice(uint256 invoiceId) external nonReentrant {
        Invoice storage invoice = _requireInvoice(invoiceId);
        Status status = _status(invoice);
        if (status == Status.Paid) revert InvoiceAlreadyPaid(invoiceId);
        if (status == Status.Cancelled) revert InvoiceAlreadyCancelled(invoiceId);
        if (status == Status.Expired) revert InvoiceExpired(invoiceId);

        invoice.payer = msg.sender;
        invoice.paidAt = uint64(block.timestamp);

        uint256 amount = invoice.amount;
        address merchant = invoice.merchant;
        address recipient = feeRecipient;
        // Full-precision multiplication avoids overflow and rounds down.
        uint256 fee = Math.mulDiv(amount, uint256(feeBps), 10_000);
        usdc.safeTransferFrom(msg.sender, merchant, amount - fee);
        if (fee > 0) usdc.safeTransferFrom(msg.sender, recipient, fee);

        emit InvoicePaid(invoiceId, merchant, msg.sender, amount, fee);
    }

    /// @notice Cancel an unpaid invoice owned by the caller, including an expired one.
    function cancelInvoice(uint256 invoiceId) external {
        Invoice storage invoice = _requireInvoice(invoiceId);
        if (invoice.merchant != msg.sender) revert NotMerchant(invoiceId);
        if (invoice.paidAt != 0) revert InvoiceAlreadyPaid(invoiceId);
        if (invoice.cancelled) revert InvoiceAlreadyCancelled(invoiceId);
        invoice.cancelled = true;
        emit InvoiceCancelled(invoiceId);
    }

    /// @notice Return invoice details and computed status; reverts if the ID does not exist.
    /// @dev Status precedence is Paid > Cancelled > Expired > Unpaid.
    function getInvoice(uint256 id) external view returns (InvoiceView memory) {
        Invoice storage invoice = _requireInvoice(id);
        return InvoiceView({
            id: id,
            merchant: invoice.merchant,
            payer: invoice.payer,
            amount: invoice.amount,
            memo: invoice.memo,
            createdAt: invoice.createdAt,
            expiresAt: invoice.expiresAt,
            paidAt: invoice.paidAt,
            status: _status(invoice)
        });
    }

    /// @notice Return a merchant's invoice IDs in creation order.
    function getMerchantInvoiceIds(address merchant) external view returns (uint256[] memory) {
        return _merchantInvoices[merchant];
    }

    /// @notice Return the number of invoices created; existing IDs range from one to this count.
    function invoiceCount() external view returns (uint256) {
        return nextInvoiceId - 1;
    }

    /// @notice Update the recipient for future payments without changing the fixed fee.
    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }

    /// @dev Disabled so the fee recipient can always be rotated if it becomes unusable.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    /// @dev Paid takes precedence over cancellation, then expiry; exact-expiry payment is allowed.
    function _status(Invoice storage invoice) private view returns (Status) {
        if (invoice.paidAt != 0) return Status.Paid;
        if (invoice.cancelled) return Status.Cancelled;
        if (invoice.expiresAt != 0 && block.timestamp > invoice.expiresAt) return Status.Expired;
        return Status.Unpaid;
    }

    /// @dev Fetch an existing invoice by storage reference.
    function _requireInvoice(uint256 id) private view returns (Invoice storage invoice) {
        invoice = _invoices[id];
        if (invoice.merchant == address(0)) revert InvoiceNotFound(id);
    }
}
