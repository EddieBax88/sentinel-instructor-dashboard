// Clickable example prompts that fill an input (they never send). Used under the Seat assistant
// input on the Overview and, through a portal, under AG Studio's Ask AI input.
export default function PromptChips({ prompts, onPick, label = 'Try one' }) {
  if (!prompts.length) return null;
  return (
    <div className="prompt-chips" role="group" aria-label={label}>
      {prompts.map((prompt) => (
        <button key={prompt} type="button" className="prompt-chip" onClick={() => onPick(prompt)}>{prompt}</button>
      ))}
    </div>
  );
}
