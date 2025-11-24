import { useState } from "react";
import { MarkdownView } from "../MarkdownView";

interface Learning {
  learningId: string;
  title: string;
  context: string;
  insight: string;
  why: string;
  tags: string[];
  abstraction: {
    concrete: string;
    pattern: string;
    principle?: string;
  };
}

interface FlashcardProps {
  learning: Learning;
}

export function Flashcard({ learning }: FlashcardProps) {
  const [flipped, setFlipped] = useState(false);

  return (
    <div className="flashcard-container">
      <div
        className={`flashcard ${flipped ? "flipped" : ""}`}
        onClick={() => setFlipped(!flipped)}
      >
        <div className="flashcard-inner">
          <div className="flashcard-front">
            <div className="flashcard-tags">
              {learning.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>

            <h3>📝 Try to recall:</h3>

            <div className="flashcard-content">
              <div className="context-section">
                <strong>Context (What triggered this learning):</strong>
                <MarkdownView content={learning.context} />
              </div>
            </div>

            <div className="flashcard-hint">Click to reveal answer</div>
          </div>

          <div className="flashcard-back">
            <div className="flashcard-tags">
              {learning.tags.slice(0, 3).map((tag) => (
                <span key={tag} className="tag">
                  {tag}
                </span>
              ))}
            </div>

            <h3>✅ Answer:</h3>

            <div className="flashcard-content">
              <div className="answer-section">
                <strong>Insight:</strong>
                <MarkdownView content={learning.insight} />
              </div>

              <div className="answer-section">
                <strong>Why:</strong>
                <MarkdownView content={learning.why} />
              </div>

              <div className="answer-section">
                <strong>Pattern:</strong>
                <p>{learning.abstraction.pattern}</p>
              </div>

              {learning.abstraction.principle && (
                <div className="answer-section">
                  <strong>Principle:</strong>
                  <p>{learning.abstraction.principle}</p>
                </div>
              )}
            </div>

            <div className="flashcard-hint">Click for next card</div>
          </div>
        </div>
      </div>
    </div>
  );
}
