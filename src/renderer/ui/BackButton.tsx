import { ArrowLeft } from 'lucide-react';
import { ICON } from '../App.js';

/**
 * Return to where you came from.
 *
 * A real button with a hit area and a hover state, rather than a line of small
 * text — it is the only way out of a detail view, so it should look like
 * something you can press.
 */
export const BackButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button className="ghost-button" onClick={onClick} title={`Back to ${label}`}>
    <ArrowLeft {...ICON} aria-hidden />
    {label}
  </button>
);
