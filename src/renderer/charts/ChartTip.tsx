/**
 * The tooltip a chart shows on hover.
 *
 * Browser `title` tooltips were doing this job: they take about a second to
 * appear, cannot be styled, and render in the OS font on a yellow slab that
 * belongs to no part of this interface.
 *
 * `text` arrives as the single string the charts already carried, of the form
 * "<when> · <value>". It is split on the first separator so the two halves can
 * be weighted differently; a string without one is shown whole.
 */
export function ChartTip({ text, x, y }: { text: string; x: number; y: number }) {
  const cut = text.indexOf(' · ');
  const heading = cut === -1 ? '' : text.slice(0, cut);
  const value = cut === -1 ? text : text.slice(cut + 3);

  return (
    <div
      className="chart-tip"
      // Never in the way of the mark it describes, and never swallowing the
      // pointer that is driving it.
      style={{ left: `${x}%`, top: y, transform: 'translate(-50%, calc(-100% - 9px))' }}
    >
      {heading && <div className="chart-tip-heading">{heading}</div>}
      <div className="chart-tip-value">{value}</div>
    </div>
  );
}
