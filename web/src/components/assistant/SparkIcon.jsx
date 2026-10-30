/**
 * The assistant's spark (D332, concept A): a four-point star that twinkles
 * while two small ones answer it. The motion and the colours per design
 * are in index.css (`.assistant-spark`); Reduce Motion stills it, and
 * `still` pauses it (the panel is open).
 */
const star = (x, y, r) =>
  `M${x} ${y - r}C${x + 0.3} ${y - 0.3} ${x + 0.3} ${y - 0.3} ${x + r} ${y} ${x + 0.3} ${y + 0.3} ${x + 0.3} ${y + 0.3} ${x} ${y + r}` +
  `${x - 0.3} ${y + 0.3} ${x - 0.3} ${y + 0.3} ${x - r} ${y} ${x - 0.3} ${y - 0.3} ${x - 0.3} ${y - 0.3} ${x} ${y - r}Z`;

export function SparkIcon({ size = 22, still = false }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={`assistant-spark ${still ? 'is-still' : ''}`} aria-hidden="true">
      <path className="spark-main" d="M12 2.5C12.7 7.6 16.4 11.3 21.5 12 16.4 12.7 12.7 16.4 12 21.5 11.3 16.4 7.6 12.7 2.5 12 7.6 11.3 11.3 7.6 12 2.5Z" />
      <path className="spark-a" d={star(20.5, 4, 2.6)} />
      <path className="spark-b" d={star(4, 19.5, 2.2)} />
    </svg>
  );
}
