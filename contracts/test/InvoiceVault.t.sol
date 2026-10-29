// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {InvoiceVault} from "../InvoiceVault.sol";

/// @dev 6-decimal mock USDC.
contract MockUSDC is ERC20 {
    constructor() ERC20("Mock USDC", "mUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev Token that calls back into the vault in the middle of transferFrom.
contract ReentrantUSDC is MockUSDC {
    InvoiceVault public vault;
    uint256 public targetInvoice;
    bool public armed;
    bool public reentryAttempted;
    bool public reentryReverted;
    bytes public reentryRevertData;
    bool public bubble; // if true, the revert is not caught

    function arm(InvoiceVault v, uint256 invoiceId, bool bubbleRevert) external {
        vault = v;
        targetInvoice = invoiceId;
        armed = true;
        bubble = bubbleRevert;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (armed && from != address(0) && to != address(0)) {
            armed = false; // only attack once
            reentryAttempted = true;
            if (bubble) {
                vault.payInvoice(targetInvoice);
            } else {
                try vault.payInvoice(targetInvoice) {
                    reentryReverted = false;
                } catch (bytes memory data) {
                    reentryReverted = true;
                    reentryRevertData = data;
                }
            }
        }
    }
}

contract InvoiceVaultTest is Test {
    InvoiceVault internal vault;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal feeRecipient = makeAddr("feeRecipient");
    address internal merchant = makeAddr("merchant");
    address internal payer = makeAddr("payer");
    address internal stranger = makeAddr("stranger");

    uint16 internal constant FEE_BPS = 100;
    uint256 internal constant START = 1_000_000;

    event InvoiceCreated(uint256 indexed id, address indexed merchant, uint256 amount, string memo, uint64 expiresAt);
    event InvoicePaid(uint256 indexed id, address indexed merchant, address indexed payer, uint256 amount, uint256 fee);
    event InvoiceCancelled(uint256 indexed id);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);

    function setUp() public {
        vm.warp(START);
        usdc = new MockUSDC();
        vm.prank(owner); // owner = msg.sender (deployer)
        vault = new InvoiceVault(address(usdc), feeRecipient, FEE_BPS);
    }

    function _assertStatus(uint256 id, InvoiceVault.Status s) internal view {
        assertEq(uint8(vault.getInvoice(id).status), uint8(s));
    }

    // ---------------------------------------------------------------- helpers

    function _create(uint256 amount, uint64 expiresAt) internal returns (uint256 id) {
        vm.prank(merchant);
        id = vault.createInvoice(amount, "memo", expiresAt);
    }

    function _fund(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(address(vault), amount);
    }

    function _pay(uint256 id) internal {
        vm.prank(payer);
        vault.payInvoice(id);
    }

    function _createFundPay(uint256 amount) internal returns (uint256 id) {
        id = _create(amount, 0);
        _fund(payer, amount);
        _pay(id);
    }

    // ------------------------------------------------------------ constructor

    function test_Constructor_StoresConfig() public view {
        assertEq(address(vault.usdc()), address(usdc));
        assertEq(vault.feeRecipient(), feeRecipient);
        assertEq(vault.feeBps(), FEE_BPS);
        assertEq(vault.owner(), owner);
        assertEq(vault.invoiceCount(), 0);
    }

    function test_Constructor_FeeCap200Ok() public {
        InvoiceVault v = new InvoiceVault(address(usdc), feeRecipient, 200);
        assertEq(v.feeBps(), 200);
    }

    function test_Constructor_FeeCap201Reverts() public {
        vm.expectRevert(abi.encodeWithSelector(InvoiceVault.FeeTooHigh.selector, uint16(201)));
        new InvoiceVault(address(usdc), feeRecipient, 201);
    }

    function test_Constructor_ZeroUsdcReverts() public {
        vm.expectRevert(InvoiceVault.ZeroAddress.selector);
        new InvoiceVault(address(0), feeRecipient, FEE_BPS);
    }

    function test_Constructor_ZeroFeeRecipientReverts() public {
        vm.expectRevert(InvoiceVault.ZeroAddress.selector);
        new InvoiceVault(address(usdc), address(0), FEE_BPS);
    }

    function test_Constructor_OwnerIsDeployer() public {
        assertEq(vault.owner(), owner);
        InvoiceVault v = new InvoiceVault(address(usdc), feeRecipient, FEE_BPS);
        assertEq(v.owner(), address(this));
        assertEq(v.pendingOwner(), address(0));
    }

    function test_Constructor_ZeroFeeBpsOk() public {
        InvoiceVault v = new InvoiceVault(address(usdc), feeRecipient, 0);
        assertEq(v.feeBps(), 0);
    }

    // ----------------------------------------------------------------- create

    function test_Create_IdsSequentialAndFieldsStored() public {
        uint64 exp = uint64(START + 1 days);
        vm.prank(merchant);
        uint256 id1 = vault.createInvoice(500e6, "first", exp);
        vm.prank(stranger);
        uint256 id2 = vault.createInvoice(7, "second", 0);
        assertEq(id1, 1);
        assertEq(id2, 2);
        assertEq(vault.invoiceCount(), 2);

        InvoiceVault.InvoiceView memory inv = vault.getInvoice(id1);
        assertEq(inv.merchant, merchant);
        assertEq(inv.memo, "first");
        assertEq(inv.payer, address(0));
        assertEq(inv.amount, 500e6);
        assertEq(inv.expiresAt, exp);
        assertEq(inv.createdAt, uint64(START));
        assertEq(inv.paidAt, 0);
        assertEq(uint8(inv.status), uint8(InvoiceVault.Status.Unpaid));
        assertEq(inv.id, id1);
        assertEq(inv.memo, "first");

        InvoiceVault.InvoiceView memory inv2 = vault.getInvoice(id2);
        assertEq(inv2.merchant, stranger);
        assertEq(inv2.amount, 7);
    }

    function test_Create_EmitsEvent() public {
        uint64 exp = uint64(START + 100);
        vm.expectEmit(true, true, false, true, address(vault));
        emit InvoiceCreated(1, merchant, 123, "hello", exp);
        vm.prank(merchant);
        vault.createInvoice(123, "hello", exp);
    }

    function test_Create_ZeroAmountReverts() public {
        vm.prank(merchant);
        vm.expectRevert(InvoiceVault.InvalidAmount.selector);
        vault.createInvoice(0, "x", 0);
    }

    function test_Create_PastExpiryReverts() public {
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(InvoiceVault.InvalidExpiry.selector, uint64(START - 1)));
        vault.createInvoice(1, "x", uint64(START - 1));
    }

    function test_Create_ExpiryEqualToNowReverts() public {
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(InvoiceVault.InvalidExpiry.selector, uint64(START)));
        vault.createInvoice(1, "x", uint64(START));
    }

    function test_Create_ZeroExpiryOk() public {
        uint256 id = _create(1, 0);
        assertEq(vault.getInvoice(id).expiresAt, 0);
        // never expires
        vm.warp(START + 3650 days);
        _fund(payer, 1);
        _pay(id);
        assertGt(vault.getInvoice(id).paidAt, 0);
    }

    function test_Create_MemoTooLongReverts() public {
        bytes memory big = new bytes(141);
        for (uint256 i; i < big.length; ++i) {
            big[i] = "a";
        }
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(InvoiceVault.MemoTooLong.selector, 141));
        vault.createInvoice(1, string(big), 0);
    }

    function test_Create_MemoMaxLengthOk() public {
        bytes memory big = new bytes(140);
        for (uint256 i; i < big.length; ++i) {
            big[i] = "a";
        }
        vm.prank(merchant);
        uint256 id = vault.createInvoice(1, string(big), 0);
        assertEq(bytes(vault.getInvoice(id).memo).length, 140);
        assertEq(vault.MAX_MEMO_LENGTH(), 140);
    }

    // -------------------------------------------------------------------- pay

    function _assertSplit(uint256 amount) internal {
        uint256 id = _create(amount, 0);
        _fund(payer, amount);
        uint256 expectedFee = (amount * 100) / 10_000;

        vm.expectEmit(true, true, true, true, address(vault));
        emit InvoicePaid(id, merchant, payer, amount, expectedFee);
        _pay(id);

        uint256 merchantBal = usdc.balanceOf(merchant);
        uint256 feeBal = usdc.balanceOf(feeRecipient);
        assertEq(feeBal, expectedFee, "fee");
        assertEq(merchantBal + feeBal, amount, "sum");
        assertEq(merchantBal, amount - expectedFee, "merchant");
        assertEq(usdc.balanceOf(address(vault)), 0, "vault holds nothing");
        assertEq(usdc.balanceOf(payer), 0, "payer drained exactly");

        InvoiceVault.InvoiceView memory inv = vault.getInvoice(id);
        assertEq(inv.payer, payer);
        assertEq(inv.paidAt, uint64(block.timestamp));
    }

    function test_Pay_Amount1() public {
        _assertSplit(1);
    }

    function test_Pay_Amount99() public {
        _assertSplit(99);
    }

    function test_Pay_Amount100() public {
        _assertSplit(100);
    }

    function test_Pay_Amount101() public {
        _assertSplit(101);
    }

    function test_Pay_Amount1_000_001() public {
        _assertSplit(1_000_001);
    }

    function test_Pay_ExplicitValues() public {
        // 1_000_001 * 1% = 10_000 (floor); merchant = 990_001
        _assertSplit(1_000_001);
        assertEq(usdc.balanceOf(feeRecipient), 10_000);
        assertEq(usdc.balanceOf(merchant), 990_001);
    }

    function test_Pay_Amount1_234_567() public {
        // fee = floor(1_234_567 * 100 / 10_000) = 12_345
        _assertSplit(1_234_567);
        assertEq(usdc.balanceOf(feeRecipient), 12_345);
        assertEq(usdc.balanceOf(merchant), 1_222_222);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_Pay_Amount100_ExactValues() public {
        _assertSplit(100);
        assertEq(usdc.balanceOf(feeRecipient), 1);
        assertEq(usdc.balanceOf(merchant), 99);
    }

    function test_Pay_TinyAmountPaysNoFee() public {
        _assertSplit(99);
        assertEq(usdc.balanceOf(feeRecipient), 0);
        assertEq(usdc.balanceOf(merchant), 99);
    }

    function testFuzz_Pay_SplitExact(uint256 amount) public {
        amount = bound(amount, 1, type(uint128).max);
        _assertSplit(amount);
    }

    function testFuzz_Pay_SplitExactAtHigherFee(uint256 amount, uint16 bps) public {
        amount = bound(amount, 1, type(uint128).max);
        bps = uint16(bound(bps, 0, 200));
        InvoiceVault v = new InvoiceVault(address(usdc), feeRecipient, bps);
        vm.prank(merchant);
        uint256 id = v.createInvoice(amount, "", 0);
        usdc.mint(payer, amount);
        vm.prank(payer);
        usdc.approve(address(v), amount);
        vm.prank(payer);
        v.payInvoice(id);
        uint256 fee = (amount * bps) / 10_000;
        assertEq(usdc.balanceOf(feeRecipient), fee);
        assertEq(usdc.balanceOf(merchant), amount - fee);
        assertEq(usdc.balanceOf(address(v)), 0);
    }

    function test_Pay_ZeroFeeVaultSkipsFeeTransfer() public {
        InvoiceVault v = new InvoiceVault(address(usdc), feeRecipient, 0);
        vm.prank(merchant);
        uint256 id = v.createInvoice(1000, "", 0);
        usdc.mint(payer, 1000);
        vm.prank(payer);
        usdc.approve(address(v), 1000);
        vm.prank(payer);
        v.payInvoice(id);
        assertEq(usdc.balanceOf(merchant), 1000);
        assertEq(usdc.balanceOf(feeRecipient), 0);
    }

    function test_Pay_RecordsPayerAndPaidAt() public {
        uint256 id = _create(1000, 0);
        _fund(payer, 1000);
        vm.warp(START + 55);
        _pay(id);
        InvoiceVault.InvoiceView memory inv = vault.getInvoice(id);
        assertEq(inv.payer, payer);
        assertEq(inv.paidAt, uint64(START + 55));
        assertEq(uint8(inv.status), uint8(InvoiceVault.Status.Paid));
    }

    function test_Pay_ThirdPartyPayerPaysFromOwnFunds() public {
        uint256 id = _create(1000, 0);
        _fund(stranger, 1000);
        vm.prank(stranger);
        vault.payInvoice(id);
        assertEq(vault.getInvoice(id).payer, stranger);
        assertEq(usdc.balanceOf(stranger), 0);
    }

    function test_Pay_CannotPayTwice() public {
        uint256 id = _createFundPay(1000);
        _fund(payer, 1000);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(InvoiceVault.InvoiceAlreadyPaid.selector, id));
        vault.payInvoice(id);
    }

    function test_Pay_CannotPayCancelled() public {
        uint256 id = _create(1000, 0);
        vm.prank(merchant);
        vault.cancelInvoice(id);
        _fund(payer, 1000);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(InvoiceVault.InvoiceAlreadyCancelled.selector, id));
        vault.payInvoice(id);
    }

    function test_Pay_PayableExactlyAtExpiry() public {
        uint64 exp = uint64(START + 100);
        uint256 id = _create(1000, exp);
        _fund(payer, 1000);
        vm.warp(exp);
        _pay(id);
        assertEq(vault.getInvoice(id).paidAt, exp);
    }

    function test_Pay_CannotPayAfterExpiry() public {
        uint64 exp = uint64(START + 100);
        uint256 id = _create(1000, exp);
        _fund(payer, 1000);
        vm.warp(uint256(exp) + 1);
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(InvoiceVault.InvoiceExpired.selector, id));
        vault.payInvoice(id);
    }

    function test_Pay_NonexistentReverts() public {
        vm.prank(payer);
        vm.expectRevert(abi.encodeWithSelector(InvoiceVault.InvoiceNotFound.selector, 42));
        vault.payInvoice(42);
        vm.expectRevert(abi.encodeWithSelector(InvoiceVault.InvoiceNotFound.selector, 0));
        vault.payInvoice(0);
    }

    function test_Pay_InsufficientAllowanceReverts_StateUnpaid() public {
        uint256 id = _create(1000, 0);
        usdc.mint(payer, 1000);
        vm.prank(payer);
        usdc.approve(address(vault), 999);
        vm.prank(payer);
        vm.expectRevert();
        vault.payInvoice(id);
        _assertUnpaidAndNoFundsMoved(id, 1000);
    }

    function test_Pay_NoAllowanceReverts_StateUnpaid() public {
        uint256 id = _create(1000, 0);
        usdc.mint(payer, 1000);
        vm.prank(payer);
        vm.expectPartialRevert(IERC20Errors.ERC20InsufficientAllowance.selector);
        vault.payInvoice(id);
        _assertUnpaidAndNoFundsMoved(id, 1000);
    }

    function test_Pay_InsufficientBalanceReverts_StateUnpaid() public {
        uint256 id = _create(1000, 0);
        usdc.mint(payer, 999);
        vm.prank(payer);
        usdc.approve(address(vault), 1000);
        vm.prank(payer);
        vm.expectRevert();
        vault.payInvoice(id);
        _assertUnpaidAndNoFundsMoved(id, 999);
    }

    function _assertUnpaidAndNoFundsMoved(uint256 id, uint256 payerBal) internal view {
        InvoiceVault.InvoiceView memory inv = vault.getInvoice(id);
        assertEq(inv.paidAt, 0);
        assertEq(inv.payer, address(0));
        assertEq(usdc.balanceOf(payer), payerBal);
        assertEq(usdc.balanceOf(merchant), 0);
        assertEq(usdc.balanceOf(feeRecipient), 0);
        assertEq(usdc.balanceOf(address(vault)), 0);
    }

    function test_Pay_CanRetryAfterFailureOnceFunded() public {
        uint256 id = _create(1000, 0);
        vm.prank(payer);
        vm.expectRevert();
        vault.payInvoice(id);
        _fund(payer, 1000);
        _pay(id);
        assertGt(vault.getInvoice(id).paidAt, 0);
    }

    // ----------------------------------------------------------------- cancel

    function test_Cancel_MerchantCanCancelAndEmits() public {
        uint256 id = _create(1000, 0);
        vm.expectEmit(true, false, false, false, address(vault));
        emit InvoiceCancelled(id);
        vm.prank(merchant);
        vault.cancelInvoice(id);
        _assertStatus(id, InvoiceVault.Status.Cancelled);
    }

    function test_Cancel_OnlyMerchant() public {
        uint256 id = _create(1000, 0);
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(InvoiceVault.NotMerchant.selector, id));
        vault.cancelInvoice(id);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(InvoiceVault.NotMerchant.selector, id));
        vault.cancelInvoice(id);
        _assertStatus(id, InvoiceVault.Status.Unpaid);
    }

    function test_Cancel_AfterPaidReverts() public {
        uint256 id = _createFundPay(1000);
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(InvoiceVault.InvoiceAlreadyPaid.selector, id));
        vault.cancelInvoice(id);
        _assertStatus(id, InvoiceVault.Status.Paid);
    }

    function test_Cancel_TwiceReverts() public {
        uint256 id = _create(1000, 0);
        vm.startPrank(merchant);
        vault.cancelInvoice(id);
        vm.expectRevert(abi.encodeWithSelector(InvoiceVault.InvoiceAlreadyCancelled.selector, id));
        vault.cancelInvoice(id);
        vm.stopPrank();
    }

    function test_Cancel_NonexistentReverts() public {
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(InvoiceVault.InvoiceNotFound.selector, 9));
        vault.cancelInvoice(9);
    }

    function test_Cancel_ExpiredInvoiceAllowed() public {
        uint256 id = _create(1000, uint64(START + 10));
        vm.warp(START + 11);
        vm.prank(merchant);
        vault.cancelInvoice(id);
        _assertStatus(id, InvoiceVault.Status.Cancelled);
    }

    // ------------------------------------------------------------------ views

    function test_GetInvoice_NonexistentReverts() public {
        vm.expectRevert(abi.encodeWithSelector(InvoiceVault.InvoiceNotFound.selector, 1));
        vault.getInvoice(1);
    }

    function test_GetMerchantInvoices() public {
        assertEq(vault.getMerchantInvoiceIds(merchant).length, 0);
        uint256 a = _create(1, 0);
        vm.prank(stranger);
        uint256 b = vault.createInvoice(2, "", 0);
        uint256 c = _create(3, 0);
        uint256[] memory ids = vault.getMerchantInvoiceIds(merchant);
        assertEq(ids.length, 2);
        assertEq(ids[0], a);
        assertEq(ids[1], c);
        uint256[] memory other = vault.getMerchantInvoiceIds(stranger);
        assertEq(other.length, 1);
        assertEq(other[0], b);
    }

    function test_InvoiceCount_TracksCreations() public {
        assertEq(vault.invoiceCount(), 0);
        _create(1, 0);
        assertEq(vault.invoiceCount(), 1);
        vm.prank(stranger);
        vault.createInvoice(2, "", 0);
        assertEq(vault.invoiceCount(), 2);
        // failed creation does not bump the count
        vm.prank(merchant);
        vm.expectRevert(InvoiceVault.InvalidAmount.selector);
        vault.createInvoice(0, "", 0);
        assertEq(vault.invoiceCount(), 2);
    }

    // ----------------------------------------------------------------- status

    function test_Status_Unpaid() public {
        uint256 id = _create(1000, uint64(START + 100));
        _assertStatus(id, InvoiceVault.Status.Unpaid);
        uint256 id2 = _create(1000, 0);
        _assertStatus(id2, InvoiceVault.Status.Unpaid);
    }

    function test_Status_UnpaidAtExactExpiry() public {
        uint64 exp = uint64(START + 100);
        uint256 id = _create(1000, exp);
        vm.warp(exp);
        _assertStatus(id, InvoiceVault.Status.Unpaid);
    }

    function test_Status_Paid() public {
        uint256 id = _createFundPay(1000);
        _assertStatus(id, InvoiceVault.Status.Paid);
        InvoiceVault.InvoiceView memory inv = vault.getInvoice(id);
        assertEq(inv.payer, payer);
        assertEq(inv.paidAt, uint64(START));
    }

    function test_Status_Cancelled() public {
        uint256 id = _create(1000, 0);
        vm.prank(merchant);
        vault.cancelInvoice(id);
        _assertStatus(id, InvoiceVault.Status.Cancelled);
    }

    function test_Status_Expired() public {
        uint64 exp = uint64(START + 100);
        uint256 id = _create(1000, exp);
        vm.warp(uint256(exp) + 1);
        _assertStatus(id, InvoiceVault.Status.Expired);
    }

    function test_Status_PaidTakesPrecedenceOverExpired() public {
        uint64 exp = uint64(START + 100);
        uint256 id = _create(1000, exp);
        _fund(payer, 1000);
        _pay(id);
        vm.warp(uint256(exp) + 1000);
        _assertStatus(id, InvoiceVault.Status.Paid);
    }

    function test_Status_CancelledTakesPrecedenceOverExpired() public {
        uint64 exp = uint64(START + 100);
        uint256 id = _create(1000, exp);
        vm.prank(merchant);
        vault.cancelInvoice(id);
        vm.warp(uint256(exp) + 1000);
        _assertStatus(id, InvoiceVault.Status.Cancelled);
    }

    function test_Status_CancelledAfterExpiryBecomesCancelled() public {
        uint64 exp = uint64(START + 100);
        uint256 id = _create(1000, exp);
        vm.warp(uint256(exp) + 1);
        _assertStatus(id, InvoiceVault.Status.Expired);
        vm.prank(merchant);
        vault.cancelInvoice(id);
        _assertStatus(id, InvoiceVault.Status.Cancelled);
    }

    function test_GetInvoice_ReturnsAllFields() public {
        uint64 exp = uint64(START + 500);
        vm.prank(merchant);
        uint256 id = vault.createInvoice(777, "memo!", exp);
        vm.warp(START + 10);
        InvoiceVault.InvoiceView memory inv = vault.getInvoice(id);
        assertEq(inv.id, id);
        assertEq(inv.merchant, merchant);
        assertEq(inv.payer, address(0));
        assertEq(inv.amount, 777);
        assertEq(inv.memo, "memo!");
        assertEq(inv.createdAt, uint64(START));
        assertEq(inv.expiresAt, exp);
        assertEq(inv.paidAt, 0);
        assertEq(uint8(inv.status), uint8(InvoiceVault.Status.Unpaid));
    }

    // -------------------------------------------------------------- ownership

    function test_Ownership_TransferNeedsAcceptance() public {
        address newOwner = makeAddr("newOwner");
        vm.expectEmit(true, true, false, false, address(vault));
        emit OwnershipTransferStarted(owner, newOwner);
        vm.prank(owner);
        vault.transferOwnership(newOwner);
        assertEq(vault.owner(), owner, "still old owner");
        assertEq(vault.pendingOwner(), newOwner);

        // pending owner cannot act until accepting
        vm.prank(newOwner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, newOwner));
        vault.setFeeRecipient(newOwner);

        // a stranger cannot accept
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.acceptOwnership();

        vm.prank(newOwner);
        vault.acceptOwnership();
        assertEq(vault.owner(), newOwner);
        assertEq(vault.pendingOwner(), address(0));

        // old owner loses rights, new owner has them
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        vault.setFeeRecipient(owner);
        vm.prank(newOwner);
        vault.setFeeRecipient(newOwner);
        assertEq(vault.feeRecipient(), newOwner);
    }

    function test_Ownership_OnlyOwnerCanTransfer() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.transferOwnership(stranger);
    }

    function test_Ownership_RenounceReverts() public {
        vm.prank(owner);
        vm.expectRevert(InvoiceVault.RenounceDisabled.selector);
        vault.renounceOwnership();
        assertEq(vault.owner(), owner);
    }

    function test_Ownership_RenounceByNonOwnerReverts() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.renounceOwnership();
        assertEq(vault.owner(), owner);
    }

    // ------------------------------------------------------- setFeeRecipient

    function test_SetFeeRecipient_OnlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vault.setFeeRecipient(stranger);
        vm.prank(merchant);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, merchant));
        vault.setFeeRecipient(merchant);
        assertEq(vault.feeRecipient(), feeRecipient);
    }

    function test_SetFeeRecipient_ZeroReverts() public {
        vm.prank(owner);
        vm.expectRevert(InvoiceVault.ZeroAddress.selector);
        vault.setFeeRecipient(address(0));
    }

    function test_SetFeeRecipient_UpdatesAndEmits() public {
        address newRec = makeAddr("newRec");
        vm.expectEmit(true, true, false, false, address(vault));
        emit FeeRecipientUpdated(feeRecipient, newRec);
        vm.prank(owner);
        vault.setFeeRecipient(newRec);
        assertEq(vault.feeRecipient(), newRec);
    }

    function test_SetFeeRecipient_NewRecipientReceivesFees() public {
        address newRec = makeAddr("newRec");
        // an invoice paid before the change pays the old recipient
        _createFundPay(10_000);
        assertEq(usdc.balanceOf(feeRecipient), 100);

        vm.prank(owner);
        vault.setFeeRecipient(newRec);

        // an invoice created before the change but paid after pays the new recipient
        _createFundPay(20_000);
        assertEq(usdc.balanceOf(newRec), 200);
        assertEq(usdc.balanceOf(feeRecipient), 100, "old recipient unchanged");
    }

    // ------------------------------------------------------------- reentrancy

    function _reentrancySetup(bool bubble)
        internal
        returns (ReentrantUSDC token, InvoiceVault v, uint256 id1, uint256 id2)
    {
        token = new ReentrantUSDC();
        v = new InvoiceVault(address(token), feeRecipient, FEE_BPS);
        vm.startPrank(merchant);
        id1 = v.createInvoice(1000, "a", 0);
        id2 = v.createInvoice(1000, "b", 0);
        vm.stopPrank();
        token.mint(payer, 2000);
        vm.prank(payer);
        token.approve(address(v), 2000);
        token.arm(v, id2, bubble);
    }

    function test_Reentrancy_NestedPayIsBlocked_OuterSucceeds() public {
        (ReentrantUSDC token, InvoiceVault v, uint256 id1, uint256 id2) = _reentrancySetup(false);
        vm.prank(payer);
        v.payInvoice(id1);

        assertTrue(token.reentryAttempted());
        assertTrue(token.reentryReverted(), "reentry must revert");
        assertEq(
            bytes4(token.reentryRevertData()),
            ReentrancyGuard.ReentrancyGuardReentrantCall.selector
        );
        assertGt(v.getInvoice(id1).paidAt, 0);
        assertEq(v.getInvoice(id2).paidAt, 0, "nested invoice untouched");
        assertEq(token.balanceOf(merchant), 990);
        assertEq(token.balanceOf(feeRecipient), 10);
        assertEq(token.balanceOf(payer), 1000);
        assertEq(token.balanceOf(address(v)), 0);
    }

    function test_Reentrancy_BubbledRevertRollsBackOuterPayment() public {
        (ReentrantUSDC token, InvoiceVault v, uint256 id1, uint256 id2) = _reentrancySetup(true);
        vm.prank(payer);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        v.payInvoice(id1);

        assertEq(v.getInvoice(id1).paidAt, 0);
        assertEq(v.getInvoice(id2).paidAt, 0);
        assertEq(token.balanceOf(payer), 2000);
        assertEq(token.balanceOf(merchant), 0);
    }

    function test_Reentrancy_SameInvoiceNestedIsBlocked() public {
        (ReentrantUSDC token, InvoiceVault v, uint256 id1,) = _reentrancySetup(false);
        token.arm(v, id1, false);
        vm.prank(payer);
        v.payInvoice(id1);
        assertTrue(token.reentryReverted());
        // payer charged exactly once
        assertEq(token.balanceOf(payer), 1000);
        assertEq(token.balanceOf(merchant) + token.balanceOf(feeRecipient), 1000);
    }
}
