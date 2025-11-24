import { useState, useEffect } from "react";

const DEFAULT_PROMPT = `You are an Isomorphism Engine. Your goal is NOT to explain the new concept from scratch,
but to "translate" it into concepts the user already knows.

INSTRUCTIONS:
1. Analyze the NEW CONCEPT the user is confused about.
2. Scan the RELATED LEARNINGS for structural/logical similarities.
   - Look for matching PATTERNS, not just matching keywords.
   - Example: "Go Channels" (new) ≈ "Redux Sagas" (old) because both handle async streams.
3. Generate a bridge explanation:
   - Start with: "This is structurally similar to [Known Concept] which you learned about..."
   - Explain the NEW concept using the OLD concept as a metaphor/analogy.
   - Be specific about what maps to what: "X in the new concept is like Y in your past learning."
4. If multiple learnings are relevant, weave them together to build understanding.

CRITICAL GUIDELINES:
- Focus on STRUCTURE and PATTERNS, not surface-level similarities.
- Be explicit about the mapping: "A does X, which is like how B did Y."
- Avoid generic explanations - leverage the specific learnings provided.
- If truly nothing matches, admit it: "This seems genuinely new - no strong analogies found."

Return your explanation as plain text (not JSON).`;

const STORAGE_KEY = "llm-archive-isomorphism-prompt";

interface PromptEditorProps {
  onPromptChange: (prompt: string) => void;
}

export function PromptEditor({ onPromptChange }: PromptEditorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [prompt, setPrompt] = useState(() => {
    // Load from localStorage on mount
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved || DEFAULT_PROMPT;
  });
  const [hasChanges, setHasChanges] = useState(false);

  // Notify parent of initial prompt
  useEffect(() => {
    onPromptChange(prompt);
  }, []);

  const handlePromptChange = (newPrompt: string) => {
    setPrompt(newPrompt);
    setHasChanges(newPrompt !== DEFAULT_PROMPT);
    onPromptChange(newPrompt);

    // Auto-save to localStorage
    localStorage.setItem(STORAGE_KEY, newPrompt);
  };

  const handleReset = () => {
    if (
      confirm(
        "Reset to default prompt? This will discard your custom changes."
      )
    ) {
      setPrompt(DEFAULT_PROMPT);
      setHasChanges(false);
      onPromptChange(DEFAULT_PROMPT);
      localStorage.setItem(STORAGE_KEY, DEFAULT_PROMPT);
    }
  };

  return (
    <div className="prompt-editor">
      <button
        className="prompt-toggle"
        onClick={() => setIsOpen(!isOpen)}
        title="Edit Isomorphism Engine prompt"
      >
        {isOpen ? "▼" : "▶"} Isomorphism Engine Prompt
        {hasChanges && <span className="prompt-modified"> (modified)</span>}
      </button>

      {isOpen && (
        <div className="prompt-editor-content">
          <div className="prompt-editor-header">
            <p className="prompt-description">
              This prompt guides how the Isomorphism Engine translates new
              concepts using your past learnings. Edit it to customize the
              explanation style.
            </p>
            <button className="reset-button" onClick={handleReset}>
              Reset to Default
            </button>
          </div>

          <textarea
            className="prompt-textarea"
            value={prompt}
            onChange={(e) => handlePromptChange(e.target.value)}
            placeholder="Enter learning extraction prompt..."
            rows={20}
          />

          <div className="prompt-info">
            <small>
              💡 Changes are saved automatically to your browser's local
              storage
            </small>
          </div>
        </div>
      )}
    </div>
  );
}
