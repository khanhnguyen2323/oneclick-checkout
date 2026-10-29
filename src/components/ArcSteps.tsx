import { ARC } from '@/config/network'
import { Step, type StepState } from '@/components/ui'
import type { ArcStep } from '@/hooks/useArcPayment'

/** Approve -> Pay -> Done, driven by real wallet and receipt state. */
export function ArcSteps({
  step,
  approved,
  failed = false,
  active = true,
}: {
  step: ArcStep
  approved: boolean
  failed?: boolean
  active?: boolean
}) {
  const approving = step === 'approve-wallet' || step === 'approve-confirming'
  const paying = step === 'pay-wallet' || step === 'pay-confirming'
  const done = step === 'done'

  const approveState: StepState = approving ? 'active' : approved || paying || done ? 'done' : 'todo'
  const payState: StepState = paying ? 'active' : done ? 'done' : 'todo'
  const doneState: StepState = done ? 'done' : 'todo'
  const detail = (wallet: ArcStep, confirming: ArcStep) =>
    step === wallet ? 'Confirm in your wallet' : step === confirming ? `Confirming on ${ARC.name}` : undefined

  return (
    <ol className="space-y-3" aria-label="Payment steps" data-failed={failed || undefined} data-active={active || undefined}>
      <Step state={approveState} label="Approve USDC" detail={detail('approve-wallet', 'approve-confirming')} />
      <Step state={payState} label="Pay invoice" detail={detail('pay-wallet', 'pay-confirming')} />
      <Step state={doneState} label="Done" />
    </ol>
  )
}
