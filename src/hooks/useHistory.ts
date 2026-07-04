import { useState, useEffect } from 'react';

export interface HistoryItem {
  id: string;
  timestamp: number;
  rawText: string;
  refinedText: string;
  style: string;
  success: boolean;
}

export function useHistory() {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    const savedHistory = localStorage.getItem("vf_history");
    if (savedHistory) {
      try {
        setHistory(JSON.parse(savedHistory));
      } catch (e) {
        console.error("Failed to load history", e);
      }
    }
  }, []);

  const saveHistory = (items: HistoryItem[]) => {
    localStorage.setItem("vf_history", JSON.stringify(items));
  };

  const addHistoryItem = (item: HistoryItem) => {
    setHistory((prev) => {
      const next = [item, ...prev].slice(0, 100);
      saveHistory(next);
      return next;
    });
  };

  const deleteHistoryItem = (id: string) => {
    setHistory((prev) => {
      const next = prev.filter(item => item.id !== id);
      saveHistory(next);
      return next;
    });
  };

  const clearHistory = () => {
    setHistory([]);
    saveHistory([]);
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  return {
    history,
    addHistoryItem,
    deleteHistoryItem,
    clearHistory,
    copyToClipboard,
    copiedId
  };
}
