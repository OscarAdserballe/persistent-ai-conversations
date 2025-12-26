import { useState, useEffect, useCallback } from "react";
import { SourcesSidebar } from "./SourcesSidebar";
import { TopicOverview } from "./TopicOverview";
import { FlashcardPanel } from "./FlashcardPanel";

interface ContentBlock {
  blockType: "qa" | "why" | "contrast";
  question: string;
  answer: string;
}

interface Learning {
  learningId: string;
  title: string;
  problemSpace: string;
  insight: string;
  blocks: ContentBlock[];
}

interface Topic {
  topicId: string;
  title: string;
  summary: string;
  keyPoints: string[];
  sourceText?: string;
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

// Fisher-Yates shuffle
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

export function StudyDeck() {
  // PDF/Topic data
  const [pdfs, setPdfs] = useState<PDFWithTopics[]>([]);
  const [pdfsLoading, setPdfsLoading] = useState(true);
  const [pdfsError, setPdfsError] = useState<string | null>(null);

  // Selected topic state
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<Topic | null>(null);
  const [topicLoading, setTopicLoading] = useState(false);

  // Learnings for selected topic
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [currentLearningIndex, setCurrentLearningIndex] = useState(0);

  // Sidebar collapsed state
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Fetch PDFs
  const fetchPdfs = useCallback(async () => {
    setPdfsLoading(true);
    try {
      const response = await fetch("http://localhost:3001/api/pdfs");
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();
      setPdfs(data.pdfs);
      setPdfsError(null);
    } catch (err) {
      setPdfsError(err instanceof Error ? err.message : "Failed to load PDFs");
    } finally {
      setPdfsLoading(false);
    }
  }, []);

  // Fetch PDFs on mount
  useEffect(() => {
    fetchPdfs();
  }, [fetchPdfs]);

  // Fetch learnings when topic is selected
  const handleSelectTopic = useCallback(async (topicId: string, _pdfId: string) => {
    setSelectedTopicId(topicId);
    setTopicLoading(true);
    setCurrentLearningIndex(0);

    try {
      const response = await fetch(
        `http://localhost:3001/api/topics/${topicId}/learnings`
      );
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const data = await response.json();

      setSelectedTopic(data.topic);
      // Shuffle learnings for random order
      setLearnings(shuffleArray(data.learnings));
    } catch (err) {
      console.error("Failed to fetch topic learnings:", err);
      setSelectedTopic(null);
      setLearnings([]);
    } finally {
      setTopicLoading(false);
    }
  }, []);

  // Go to next learning
  const handleNextLearning = useCallback(() => {
    setCurrentLearningIndex((prev) => {
      if (prev < learnings.length - 1) {
        return prev + 1;
      }
      // Loop back to beginning with new shuffle
      setLearnings(shuffleArray(learnings));
      return 0;
    });
  }, [learnings]);

  const currentLearning = learnings[currentLearningIndex] ?? null;

  if (pdfsError) {
    return (
      <div className="study-deck error">
        <div className="error-message">
          <h3>Failed to load sources</h3>
          <p>{pdfsError}</p>
          <button onClick={() => window.location.reload()}>Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className={`study-deck ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      <SourcesSidebar
        pdfs={pdfs}
        selectedTopicId={selectedTopicId}
        onSelectTopic={handleSelectTopic}
        onRefresh={fetchPdfs}
        loading={pdfsLoading}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
      />

      <TopicOverview topic={selectedTopic} loading={topicLoading} />

      <FlashcardPanel
        learning={currentLearning}
        currentIndex={currentLearningIndex}
        totalCount={learnings.length}
        onNext={handleNextLearning}
        loading={topicLoading}
      />
    </div>
  );
}
