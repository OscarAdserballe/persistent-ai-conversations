import { useState } from "react";

interface Topic {
  topicId: string;
  title: string;
  summary: string;
  depth: number;
  parentTopicId?: string;
}

interface PDFWithTopics {
  id: string;
  filename: string;
  title?: string;
  documentType: string;
  topics: Topic[];
}

type ExtractionStatus = "idle" | "extracting-topics" | "extracting-learnings";

interface SourcesSidebarProps {
  pdfs: PDFWithTopics[];
  selectedTopicId: string | null;
  onSelectTopic: (topicId: string, pdfId: string) => void;
  onRefresh: () => void;
  loading?: boolean;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function SourcesSidebar({
  pdfs,
  selectedTopicId,
  onSelectTopic,
  onRefresh,
  loading,
  collapsed,
  onToggleCollapse,
}: SourcesSidebarProps) {
  const [expandedPdfs, setExpandedPdfs] = useState<Set<string>>(new Set());
  const [extractionStatus, setExtractionStatus] = useState<
    Map<string, ExtractionStatus>
  >(new Map());

  const togglePdf = (pdfId: string) => {
    setExpandedPdfs((prev) => {
      const next = new Set(prev);
      if (next.has(pdfId)) {
        next.delete(pdfId);
      } else {
        next.add(pdfId);
      }
      return next;
    });
  };

  const extractTopics = async (pdfId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExtractionStatus((prev) => new Map(prev).set(pdfId, "extracting-topics"));

    try {
      const response = await fetch(
        `http://localhost:3001/api/pdfs/${pdfId}/extract-topics`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overwrite: false }),
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to extract topics");
      }

      const result = await response.json();
      console.log("Topics extracted:", result);
      onRefresh();
    } catch (error) {
      console.error("Topic extraction failed:", error);
      alert(`Topic extraction failed: ${(error as Error).message}`);
    } finally {
      setExtractionStatus((prev) => {
        const next = new Map(prev);
        next.delete(pdfId);
        return next;
      });
    }
  };

  const extractLearnings = async (pdfId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setExtractionStatus((prev) =>
      new Map(prev).set(pdfId, "extracting-learnings")
    );

    try {
      const response = await fetch(
        `http://localhost:3001/api/pdfs/${pdfId}/extract-learnings`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }
      );

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || "Failed to extract learnings");
      }

      const result = await response.json();
      console.log("Learnings extracted:", result);
      alert(
        `Extracted ${result.totalLearnings} learnings from ${result.topicsProcessed} topics`
      );
    } catch (error) {
      console.error("Learning extraction failed:", error);
      alert(`Learning extraction failed: ${(error as Error).message}`);
    } finally {
      setExtractionStatus((prev) => {
        const next = new Map(prev);
        next.delete(pdfId);
        return next;
      });
    }
  };

  // Collapsed state - just show toggle button
  if (collapsed) {
    return (
      <div className="sources-sidebar collapsed">
        <button className="sidebar-toggle" onClick={onToggleCollapse} title="Expand sources">
          ►
        </button>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="sources-sidebar">
        <div className="sidebar-header">
          <h2 className="sidebar-title">Sources</h2>
          <button className="sidebar-toggle" onClick={onToggleCollapse} title="Collapse">
            ◄
          </button>
        </div>
        <div className="sidebar-loading">Loading...</div>
      </div>
    );
  }

  if (pdfs.length === 0) {
    return (
      <div className="sources-sidebar">
        <div className="sidebar-header">
          <h2 className="sidebar-title">Sources</h2>
          <button className="sidebar-toggle" onClick={onToggleCollapse} title="Collapse">
            ◄
          </button>
        </div>
        <div className="sidebar-empty">No PDFs found</div>
      </div>
    );
  }

  return (
    <div className="sources-sidebar">
      <div className="sidebar-header">
        <h2 className="sidebar-title">Sources</h2>
        <button className="sidebar-toggle" onClick={onToggleCollapse} title="Collapse">
          ◄
        </button>
      </div>
      <div className="pdf-list">
        {pdfs.map((pdf) => {
          const isExpanded = expandedPdfs.has(pdf.id);
          const mainTopics = pdf.topics.filter((t) => t.depth === 0);
          const hasTopics = mainTopics.length > 0;
          const status = extractionStatus.get(pdf.id) || "idle";
          const isExtracting = status !== "idle";

          return (
            <div key={pdf.id} className="pdf-item">
              <div className="pdf-row">
                <button
                  className={`pdf-header ${isExpanded ? "expanded" : ""}`}
                  onClick={() => togglePdf(pdf.id)}
                  disabled={isExtracting}
                >
                  <span className="pdf-icon">
                    {isExtracting ? (
                      <span className="spinner">⟳</span>
                    ) : hasTopics ? (
                      isExpanded ? "▼" : "►"
                    ) : (
                      "○"
                    )}
                  </span>
                  <span className="pdf-name">
                    {pdf.title || pdf.filename.replace(".pdf", "")}
                  </span>
                  {hasTopics && (
                    <span className="topic-count">{mainTopics.length}</span>
                  )}
                </button>

                {/* Inline extraction buttons */}
                <div className="extract-buttons">
                  {isExtracting ? (
                    <span className="extract-spinner">⟳</span>
                  ) : (
                    <>
                      <button
                        className="extract-btn-small extract-topics"
                        onClick={(e) => extractTopics(pdf.id, e)}
                        title={hasTopics ? "Re-extract topics" : "Extract topics"}
                      >
                        T
                      </button>
                      <button
                        className={`extract-btn-small extract-learnings ${!hasTopics ? "disabled" : ""}`}
                        onClick={(e) => hasTopics && extractLearnings(pdf.id, e)}
                        title={hasTopics ? "Extract learnings" : "Extract topics first"}
                        disabled={!hasTopics}
                      >
                        L
                      </button>
                    </>
                  )}
                </div>
              </div>

              {isExpanded && hasTopics && (
                <div className="topic-list">
                  {mainTopics.map((topic) => {
                    const subtopics = pdf.topics.filter(
                      (t) => t.parentTopicId === topic.topicId
                    );
                    const isSelected = selectedTopicId === topic.topicId;

                    return (
                      <div key={topic.topicId} className="topic-tree">
                        <button
                          className={`topic-item ${isSelected ? "selected" : ""}`}
                          onClick={() => onSelectTopic(topic.topicId, pdf.id)}
                        >
                          <span className="topic-bullet">├</span>
                          <span className="topic-title">{topic.title}</span>
                        </button>

                        {subtopics.map((subtopic, idx) => {
                          const isLast = idx === subtopics.length - 1;
                          const isSubSelected =
                            selectedTopicId === subtopic.topicId;

                          return (
                            <button
                              key={subtopic.topicId}
                              className={`topic-item subtopic ${isSubSelected ? "selected" : ""}`}
                              onClick={() =>
                                onSelectTopic(subtopic.topicId, pdf.id)
                              }
                            >
                              <span className="topic-bullet">
                                {isLast ? "└" : "├"}
                              </span>
                              <span className="topic-title">
                                {subtopic.title}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
