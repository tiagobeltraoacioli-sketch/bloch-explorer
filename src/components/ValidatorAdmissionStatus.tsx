import { useEffect, useState } from "react";
import { g4rpc } from "../lib/g4";

type Admission = {
  active: boolean;
  epoch: number;
  activation_epoch: number | null;
  minimum_stake_sat: string;
  activation_delay_epochs: number;
};

export function ValidatorAdmissionStatus() {
  const [admission, setAdmission] = useState<Admission | null>(null);
  const [checked, setChecked] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await g4rpc<Admission>("getvalidatoradmission", [], { signal: controller.signal });
        if (controller.signal.aborted) return;
        setAdmission(value);
        setChecked(new Date().toISOString().slice(11, 19) + " UTC");
        setError(false);
      } catch {
        if (controller.signal.aborted) return;
        setError(true);
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 15000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  return <aside className="guide-notice" aria-label="Live validator admission status">
    <strong>{error ? "Admission status unavailable" : admission ? admission.active ? "Protocol admission is active" : "Protocol admission is not active yet" : "Checking admission status…"}</strong>
    {error ? <p>The live check failed. Confirm getvalidatoradmission on your own synchronized node before submitting.</p> : admission ? <p>Node epoch: {admission.epoch}. Activation epoch: {admission.activation_epoch ?? "not scheduled"}. Checked at {checked}. This is a protocol status, not proof that the complete withdrawal cycle has been qualified.</p> : <p>Reading the current node response. The scheduled time alone does not authorize a deposit.</p>}
    <p>Scheduled activation: September 14, 2026 at 22:35:19 UTC (19:35:19 Brasília). Allow at least 8 epochs (128 minutes) after deposit registration, plus finalization and queue conditions, before validator activation.</p>
  </aside>;
}
