import { useState } from "react";
import { MarkdownView } from "../MarkdownView";
import { PromptEditor } from "./PromptEditor";

interface Abstraction {
  concrete: string;
  pattern: string;
  principle?: string;
}

interface Learning {
  learningId: string;
  title: string;
  context: string;
  insight: string;
  why: string;
  tags: string[];
  abstraction: Abstraction;
}

interface IsomorphismResult {
  newConcept: string;
  relatedLearnings: Learning[];
  synthesis: string;
  patterns: string[];
  confidence: number;
  timestamp: string;
}

export function ExplainView() {
  const [concept, setConcept] = useState("");
  const [result, setResult] = useState<IsomorphismResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customPrompt, setCustomPrompt] = useState<string | null>(null);

  const handleExplain = async () => {
    if (!concept.trim()) return;

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const response = await fetch("http://localhost:3001/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          concept,
          customPrompt: customPrompt || undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      handleExplain();
    }
  };

  return (
    <div>
      <div className="input-section">
        <textarea
          value={concept}
          onChange={(e) => setConcept(e.target.value)}
          onKeyDown={handleKeyPress}
          placeholder="Enter a confusing concept... (e.g., 'How do Go channels work?')

Tip: Press Cmd/Ctrl + Enter to explain"
          rows={4}
          disabled={loading}
        />
        <button onClick={handleExplain} disabled={loading || !concept.trim()}>
          {loading ? "Thinking..." : "Explain"}
        </button>
      </div>

      <PromptEditor onPromptChange={setCustomPrompt} />

      {error && (
        <div className="error">
          <strong>Error:</strong> {error}
        </div>
      )}

      {result && (
        <div className="results">
          <div className="synthesis">
            <h2>Bridge Explanation</h2>
            <div className="confidence">
              Confidence: {(result.confidence * 100).toFixed(0)}%
            </div>
            <div className="synthesis-text">
              <MarkdownView content={result.synthesis} />
            </div>
          </div>

          {result.patterns.length > 0 && (
            <div className="patterns">
              <h3>Patterns Found:</h3>
              <ul>
                {result.patterns.map((pattern, i) => (
                  <li key={i}>{pattern}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="learnings">
            <h3>Related Learnings ({result.relatedLearnings.length})</h3>
            {result.relatedLearnings.map((learning) => (
              <div key={learning.learningId} className="learning-card">
                <h4>{learning.title}</h4>
                <div className="tags">
                  {learning.tags.map((tag) => (
                    <span key={tag} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
                <p>
                  <strong>Pattern:</strong> {learning.abstraction.pattern}
                </p>
                {learning.abstraction.principle && (
                  <p>
                    <strong>Principle:</strong>{" "}
                    {learning.abstraction.principle}
                  </p>
                )}
                <details>
                  <summary>More details</summary>
                  <div className="learning-details">
                    <p>
                      <strong>Context:</strong>
                      <MarkdownView content={learning.context} />
                    </p>
                    <p>
                      <strong>Insight:</strong>
                      <MarkdownView content={learning.insight} />
                    </p>
                    <p>
                      <strong>Why:</strong>
                      <MarkdownView content={learning.why} />
                    </p>
                  </div>
                </details>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
