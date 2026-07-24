import { useState } from 'react';
import PerformanceReport from './PerformanceReport';
import UploadScreen from './UploadScreen';
import type { ReportSummaryData } from './types';

function App() {
  const [reportData, setReportData] = useState<ReportSummaryData | null>(null);
  const [startInEditMode, setStartInEditMode] = useState(false);

  const handleLoad = (data: ReportSummaryData, editMode: boolean) => {
    setReportData(data);
    setStartInEditMode(editMode);
  };

  const handleBackToUpload = () => {
    if (!window.confirm('アップロード画面に戻りますか？現在の表示内容は破棄されます。')) return;
    setReportData(null);
  };

  if (!reportData) {
    return <UploadScreen onLoad={handleLoad} />;
  }

  return (
    <div className="min-h-screen bg-slate-100 py-8 print:bg-white print:py-0">
      <PerformanceReport
        data={reportData}
        startInEditMode={startInEditMode}
        onBackToUpload={handleBackToUpload}
      />
    </div>
  );
}

export default App;
