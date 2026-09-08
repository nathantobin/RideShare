import type { ComponentChildren } from "preact";

interface StepProps {
  number: number;
  title: string;
  summary: string;
  open: boolean;
  done?: boolean;
  locked?: boolean;
  /** Left out for a step that isn't collapsible, like Settle up. */
  onToggle?: () => void;
  children?: ComponentChildren;
}

/** One numbered section of a trip page, collapsed to a summary when closed. */
export function Step({ number, title, summary, open, done, locked, onToggle, children }: StepProps) {
  const classes = ["step", open && !locked ? "open" : "", locked ? "locked" : "", done ? "done" : ""];
  const heading = (
    <>
      <span class="num">{number}</span>
      <span class="step-title">{title}</span>
      <span class="step-sum">{summary}</span>
    </>
  );

  return (
    <section class={classes.filter(Boolean).join(" ")}>
      {onToggle && !locked
        ? <button class="step-head" onClick={onToggle}>{heading}</button>
        : <div class="step-head static">{heading}</div>}
      {open && !locked && <div class="step-body">{children}</div>}
    </section>
  );
}
