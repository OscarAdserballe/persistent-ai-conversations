import { useState } from "react";
import { MarkdownView } from "../MarkdownView";

interface Learning {
  learningId: string;
  title: string;
  context: string;
  insight: string;
  why: string;
  implications: string;
  tags: string[];
  abstraction: {
    concrete: string;
    pattern: string;
    principle?: string;
  };
  createdAt: string;
}

interface LearningCardProps {
  learning: Learning;
}

export function LearningCard({ learning }: LearningCardProps) {
  const [expanded, setExpanded] = useState(false);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return "Today";
    } else if (date.toDateString() === yesterday.toDateString()) {
      return "Yesterday";
    } else {
      return date.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      });
    }
  };

  return (
    <div className="learning-card">
      <div className="learning-card-header">
        <span className="learning-date">{formatDate(learning.createdAt)}</span>
      </div>

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
          <strong>Principle:</strong> {learning.abstraction.principle}
        </p>
      )}

      <button
        className="expand-button"
        onClick={() => setExpanded(!expanded)}
      >
        {expanded ? "Hide Details ▲" : "Show Details ▼"}
      </button>

      {expanded && (
        <div className="learning-details">
          <div className="detail-section">
            <strong>Context:</strong>
            <MarkdownView content={learning.context} />
          </div>
          <div className="detail-section">
            <strong>Insight:</strong>
            <MarkdownView content={learning.insight} />
          </div>
          <div className="detail-section">
            <strong>Why:</strong>
            <MarkdownView content={learning.why} />
          </div>
          <div className="detail-section">
            <strong>Implications:</strong>
            <MarkdownView content={learning.implications} />
          </div>
        </div>
      )}
    </div>
  );
}
