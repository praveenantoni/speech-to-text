
import React, { useState, useCallback, ChangeEvent, useRef, useEffect } from 'react';
import { transcribeAudio } from './services/geminiService';
import { TimestampMode, TimestampFormat, Punctuation, TranscriptionSettings, TranscriptionCue, TranscriptionItem, ProcessingStatus } from './types';
import { UploadIcon, FileAudioIcon, CopyIcon, CheckIcon, DownloadIcon, VideoCameraIcon, PlayIcon, PauseIcon, TrashIcon, ListIcon, CloudIcon } from './components/icons';


// Make WaveSurfer available from the global scope (loaded via CDN)
declare const WaveSurfer: any;

// Reusable UI Components
interface RadioGroupProps<T extends string> {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  disabled?: boolean;
}

const RadioGroup = <T extends string>({ label, value, onChange, options, disabled }: RadioGroupProps<T>) => (
  <div>
    <label className="block text-sm font-medium text-slate-400 mb-2">{label}</label>
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          disabled={disabled}
          className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-slate-900 focus:ring-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed ${
            value === option.value
              ? 'bg-cyan-600 text-white shadow-md'
              : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  </div>
);

interface ToggleSwitchProps {
  label: string;
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  disabled?: boolean;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({ label, enabled, onChange, disabled }) => (
  <div className="flex items-center justify-between w-full">
    <span className="text-sm font-medium text-slate-400">{label}</span>
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      disabled={disabled}
      className={`${
        enabled ? 'bg-cyan-600' : 'bg-slate-700'
      } relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:ring-offset-2 focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed`}
    >
      <span
        className={`${
          enabled ? 'translate-x-5' : 'translate-x-0'
        } pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out`}
      />
    </button>
  </div>
);

interface FileUploadProps {
    onFilesAdded: (files: File[]) => void;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFilesAdded }) => {
    const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            onFilesAdded(Array.from(e.target.files));
        }
        // Reset input so same file can be selected again if needed
        e.target.value = '';
    };

    const handleDragOver = (e: React.DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        e.stopPropagation();
    };

    const handleDrop = (e: React.DragEvent<HTMLLabelElement>) => {
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            onFilesAdded(Array.from(e.dataTransfer.files));
        }
    };

    return (
        <div className="w-full">
            <label
                htmlFor="media-upload"
                className="flex cursor-pointer justify-center rounded-lg border-2 border-dashed border-slate-600 px-6 py-8 transition-colors duration-200 hover:border-cyan-500 bg-slate-800/30 hover:bg-slate-800/50"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            >
                <div className="text-center">
                    <UploadIcon className="mx-auto h-10 w-10 text-slate-500 mb-2" />
                    <p className="mt-1 text-sm text-slate-300">
                        Drag & drop or <span className="font-semibold text-cyan-400">browse</span>
                    </p>
                    <p className="text-xs text-slate-500 mt-1">MP3, WAV, MP4, MOV</p>
                    <input id="media-upload" name="media-upload" type="file" className="sr-only" onChange={handleFileChange} accept="audio/*,video/*" multiple />
                </div>
            </label>
        </div>
    );
};

// Utility Functions

const parseTimestamp = (timestamp: string | number): number => {
    if (typeof timestamp === 'number') {
        return Math.round(timestamp * 1000);
    }
    if (!timestamp) return NaN;
    const time = timestamp.replace(/[\[\]"']/g, '').trim();
    if (!time) return NaN;

    if (time.endsWith('ms')) return parseInt(time.replace('ms', ''), 10);
    if (/^\d+(\.\d+)?s?$/.test(time)) return Math.round(parseFloat(time.replace('s', '')) * 1000);

    let timePart = time;
    let msPart = '0';
    
    const separators = ['.', ','];
    let sepIndex = -1;
    for (const sep of separators) {
        sepIndex = time.lastIndexOf(sep);
        if (sepIndex !== -1) break;
    }

    if (sepIndex !== -1) {
        timePart = time.substring(0, sepIndex);
        msPart = time.substring(sepIndex + 1);
    }

    const timeSegments = timePart.split(':').map(t => parseInt(t, 10));

    let hours = 0;
    let minutes = 0;
    let seconds = 0;
    
    if (timeSegments.length === 3) [hours, minutes, seconds] = timeSegments;
    else if (timeSegments.length === 2) [minutes, seconds] = timeSegments;
    else if (timeSegments.length === 1) [seconds] = timeSegments;
    else if (timeSegments.length === 4) {
         hours = timeSegments[0];
         minutes = timeSegments[1];
         seconds = timeSegments[2];
         msPart = timeSegments[3].toString();
    } else return NaN;

    const milliseconds = parseInt(msPart.padEnd(3, '0').substring(0, 3), 10);
    const totalMs = (hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds;
    
    return isNaN(totalMs) ? NaN : totalMs;
};


const parseTranscription = (rawText: string): TranscriptionCue[] => {
    if (!rawText) return [];

    try {
        const json = JSON.parse(rawText);
        if (Array.isArray(json)) {
            return json.map((item: any) => {
                 const start = parseTimestamp(item.start);
                 const end = parseTimestamp(item.end);
                 const word = item.text || item.word; 
                 if (isNaN(start) || isNaN(end) || !word) return null;
                 return { word, start, end };
            }).filter((cue: any): cue is TranscriptionCue => cue !== null);
        }
    } catch (e) {
        // Fallback
    }
    
    const regex = /((?:\d{1,2}:)?(?:\d{1,2}:)?\d{1,2}(?:[:.,]\d{1,3})?|\d+ms)\s*-{1,2}>\s*((?:\d{1,2}:)?(?:\d{1,2}:)?\d{1,2}(?:[:.,]\d{1,3})?|\d+ms)\s*(?:["']?)(.*?)(?:["']?)\s*$/gm;
    const matches = Array.from(rawText.matchAll(regex));

    return matches.map(match => {
        const start = parseTimestamp(match[1].trim());
        const end = parseTimestamp(match[2].trim());
        let word = match[3].replace(/^["']+|["']+$/g, ''); 
        if (/^\d+\s+(?=[a-zA-Z])/.test(word)) word = word.replace(/^\d+\s+/, '');
        if (isNaN(start) || isNaN(end) || !word) return null;
        return { word, start, end };
    }).filter((cue): cue is TranscriptionCue => cue !== null);
};

const formatTime = (totalMilliseconds: number, format: TimestampFormat, separator = '.'): string => {
    const roundedMs = Math.round(totalMilliseconds);
    if (format === TimestampFormat.MS) return `${String(roundedMs).padStart(6, '0')}ms`;

    const totalSeconds = Math.floor(roundedMs / 1000);
    const hours = Math.floor(totalSeconds / 3600).toString().padStart(2, '0');
    const minutes = Math.floor((totalSeconds % 3600) / 60).toString().padStart(2, '0');
    const seconds = (totalSeconds % 60).toString().padStart(2, '0');
    const milliseconds = (roundedMs % 1000).toString().padStart(3, '0');
    return `${hours}:${minutes}:${seconds}${separator}${milliseconds}`;
};


const generateVTT = (cues: TranscriptionCue[]): string => {
    let vttContent = 'WEBVTT\n\n';
    cues.forEach((cue) => {
        const start = formatTime(cue.start, TimestampFormat.HMS);
        const end = formatTime(cue.end, TimestampFormat.HMS);
        vttContent += `${start} --> ${end}\n${cue.word}\n\n`;
    });
    return vttContent;
};

const App: React.FC = () => {
  const [settings, setSettings] = useState<TranscriptionSettings>({
    timestampMode: TimestampMode.WORDSTAMP,
    timestampFormat: TimestampFormat.HMS,
    punctuation: Punctuation.ON,
  });

  // Multiple Files State
  const [items, setItems] = useState<TranscriptionItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [isProcessingQueue, setIsProcessingQueue] = useState(false);

  // Derived Active Item State
  const activeItem = items.find(i => i.id === activeId) || null;
  const [activeMediaUrl, setActiveMediaUrl] = useState<string | null>(null);
  const [activeDuration, setActiveDuration] = useState<number | null>(null);

  // UI State
  const [copied, setCopied] = useState<boolean>(false);
  const [activeCueIndex, setActiveCueIndex] = useState<number>(-1);
  const outputRef = useRef<HTMLDivElement>(null);
  
  // Media refs
  const videoRef = useRef<HTMLVideoElement>(null);
  const waveformContainerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<any>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isWaveformReady, setIsWaveformReady] = useState(false);
  const [playerCurrentTime, setPlayerCurrentTime] = useState(0);

  // Refs for stability
  const cuesRef = useRef<TranscriptionCue[]>([]);
  useEffect(() => {
    cuesRef.current = activeItem?.cues || [];
  }, [activeItem]);

  // Handle Active File Blob URL lifecycle
  useEffect(() => {
    if (!activeItem) {
        setActiveMediaUrl(null);
        return;
    }
    const url = URL.createObjectURL(activeItem.file);
    setActiveMediaUrl(url);

    // Reset player state when file changes
    setIsPlaying(false);
    setPlayerCurrentTime(0);
    setActiveCueIndex(-1);
    setIsWaveformReady(false);
    setActiveDuration(null);

    return () => {
        URL.revokeObjectURL(url);
    };
  }, [activeItem?.id]); // Only recreate if ID changes, not if status changes

  const handleFilesAdded = (files: File[]) => {
      const newItems: TranscriptionItem[] = files.map(file => ({
          id: crypto.randomUUID(),
          file,
          mediaType: file.type.startsWith('video/') ? 'video' : 'audio',
          status: 'idle',
          cues: [],
          fullTranscript: '',
          timestamp: Date.now()
      }));

      setItems(prev => [...prev, ...newItems]);
      
      // Auto-select first if none selected
      if (!activeId && newItems.length > 0) {
          setActiveId(newItems[0].id);
      }
  };

  const removeFile = (e: React.MouseEvent, id: string) => {
      e.stopPropagation();
      setItems(prev => prev.filter(i => i.id !== id));
      if (activeId === id) {
          setActiveId(null);
      }
  };

  const clearAllFiles = () => {
      if (isProcessingQueue) return;
      setItems([]);
      setActiveId(null);
  };

  const updateItemStatus = (id: string, updates: Partial<TranscriptionItem>) => {
      setItems(prev => prev.map(item => item.id === id ? { ...item, ...updates } : item));
  };

  const processFile = async (item: TranscriptionItem) => {
      updateItemStatus(item.id, { status: 'transcribing', error: undefined });
      
      try {
          // Duration is optional, passing null is fine
          const result = await transcribeAudio(settings, item.file, null);
          const parsedCues = parseTranscription(result);
          
          let fullText = '';
          if (parsedCues.length === 0 && result.length > 0) {
             fullText = result;
          } else {
             fullText = parsedCues.map(c => c.word).join(' ');
          }

          updateItemStatus(item.id, { 
              status: 'completed', 
              cues: parsedCues, 
              fullTranscript: fullText 
          });

      } catch (err) {
          const msg = err instanceof Error ? err.message : 'Unknown error';
          updateItemStatus(item.id, { status: 'error', error: msg });
      }
  };

  const handleTranscribeAll = async () => {
      if (isProcessingQueue) return;
      setIsProcessingQueue(true);

      const idleItems = items.filter(i => i.status === 'idle' || i.status === 'error');
      
      // Sequential processing to avoid rate limits
      for (const item of idleItems) {
          await processFile(item);
      }
      
      setIsProcessingQueue(false);
  };

  const handleTranscribeSingle = async (e: React.MouseEvent, item: TranscriptionItem) => {
      e.stopPropagation();
      await processFile(item);
  };

  // Player & Sync Logic
  const handleTimeUpdate = useCallback((currentTime: number) => {
    const currentCues = cuesRef.current;
    if (currentCues.length === 0) return;
    
    const currentTimeMs = currentTime * 1000;
    const currentCueIndex = currentCues.findIndex(cue => currentTimeMs >= cue.start && currentTimeMs <= cue.end);

    setActiveCueIndex(prev => {
        if (prev !== currentCueIndex) return currentCueIndex;
        return prev;
    });
  }, []);

  useEffect(() => {
    if (activeCueIndex > -1) {
        const activeElement = outputRef.current?.querySelector(`[data-cue-index='${activeCueIndex}']`);
        activeElement?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeCueIndex]);

  // WaveSurfer Setup
  useEffect(() => {
    if (!waveformContainerRef.current || !activeItem || activeItem.mediaType !== 'audio' || !activeMediaUrl) {
      if (wavesurferRef.current) {
        wavesurferRef.current.destroy();
        wavesurferRef.current = null;
      }
      return;
    }
    
    if (wavesurferRef.current) wavesurferRef.current.destroy();

    const ws = WaveSurfer.create({
        container: waveformContainerRef.current,
        waveColor: 'rgb(107 114 128)',
        progressColor: 'rgb(34 211 238)',
        cursorColor: 'rgb(203 213 225)',
        cursorWidth: 1,
        barWidth: 3,
        barGap: 3,
        barRadius: 3,
        height: 30,
        url: activeMediaUrl,
    });

    wavesurferRef.current = ws;

    ws.on('ready', () => {
        setIsWaveformReady(true);
        setActiveDuration(ws.getDuration());
    });
    
    ws.on('timeupdate', (currentTime: number) => {
        handleTimeUpdate(currentTime);
        setPlayerCurrentTime(currentTime);
    });
    
    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('finish', () => {
        setIsPlaying(false);
        setActiveCueIndex(-1);
        ws.seekTo(0);
    });

    return () => ws.destroy();
  }, [activeMediaUrl, activeItem?.mediaType]);

  const handleSettingsChange = useCallback(<K extends keyof TranscriptionSettings>(key: K, value: TranscriptionSettings[K]) => {
     setSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  const copyToClipboard = () => {
    if (!activeItem) return;
    const text = activeItem.cues.length > 0 
        ? activeItem.cues.map(c => c.word).join(' ') 
        : activeItem.fullTranscript;

    if (text) {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }
  };

  const downloadVTT = () => {
    if (!activeItem || activeItem.cues.length === 0) return;
    const vttContent = generateVTT(activeItem.cues);
    const blob = new Blob([vttContent], { type: 'text/vtt' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeItem.file.name.split('.').slice(0, -1).join('.')}.vtt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const formatPlayerTime = (seconds: number) => {
    if (isNaN(seconds) || seconds < 0) return '00:00:00';
    return new Date(seconds * 1000).toISOString().slice(11, 19);
  };

  return (
    <div className="min-h-screen bg-slate-900 font-sans p-4 sm:p-6 lg:p-8">
      <div className="max-w-[1600px] mx-auto">
        <header className="flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-6 mb-10">
            <div className="relative">
                <div className="absolute -inset-4 bg-cyan-500/10 blur-xl rounded-full opacity-50"></div>
                <img 
                    src="/logo.png" 
                    alt="TechWolf" 
                    className="relative h-16 w-auto object-contain drop-shadow-[0_0_15px_rgba(6,182,212,0.5)]"
                />
            </div>
            <h1 className="text-2xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 tracking-tight">
                Audio Transcription Assistant
            </h1>
        </header>

        <main className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          
          {/* COLUMN 1: Settings (3 cols) */}
          <aside className="lg:col-span-3 space-y-6">
             <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700 shadow-lg h-full">
                <h2 className="text-xl font-bold mb-4 text-white border-b border-slate-700 pb-2">Settings</h2>
                <div className="space-y-6">
                  <RadioGroup
                    label="Timestamp Level"
                    value={settings.timestampMode}
                    onChange={(value) => handleSettingsChange('timestampMode', value)}
                    options={[
                      { value: TimestampMode.WORDSTAMP, label: 'Word-by-word' },
                      { value: TimestampMode.SENTENCE, label: 'Sentence' },
                    ]}
                    disabled={isProcessingQueue}
                  />
                  <RadioGroup
                    label="Timestamp Format"
                    value={settings.timestampFormat}
                    onChange={(value) => handleSettingsChange('timestampFormat', value)}
                    options={[
                      { value: TimestampFormat.HMS, label: 'hh:mm:ss.000' },
                      { value: TimestampFormat.MS, label: 'milliseconds' },
                    ]}
                    disabled={isProcessingQueue}
                  />
                  <ToggleSwitch
                    label="Punctuation"
                    enabled={settings.punctuation === Punctuation.ON}
                    onChange={(enabled) => handleSettingsChange('punctuation', enabled ? Punctuation.ON : Punctuation.OFF)}
                    disabled={isProcessingQueue}
                  />
                </div>
             </div>
          </aside>

          {/* COLUMN 2: Upload & Queue (4 cols) */}
          <section className="lg:col-span-4 space-y-6">
            <FileUpload onFilesAdded={handleFilesAdded} />
            
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 shadow-lg overflow-hidden flex flex-col min-h-[400px] max-h-[600px]">
                <div className="p-4 border-b border-slate-700 bg-slate-800 flex justify-between items-center">
                    <div className="flex items-center gap-2">
                        <ListIcon className="w-5 h-5 text-cyan-400" />
                        <h3 className="font-semibold text-white">File Queue</h3>
                        <span className="text-xs bg-slate-700 px-2 py-0.5 rounded-full text-slate-300">{items.length}</span>
                    </div>
                    <div className="flex gap-2 items-center">
                        <a 
                            href="https://drive.google.com/drive/folders/1PecvCkzNQpEcW5O6zCM9_hS1UtHWedB4?usp=sharing"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs bg-slate-700 hover:bg-slate-600 text-cyan-400 border border-slate-600 px-2 py-1.5 rounded-md transition-colors flex items-center gap-1"
                            title="Open Google Drive Folder"
                        >
                            <CloudIcon className="w-4 h-4" />
                        </a>
                        {items.length > 0 && (
                            <button
                                onClick={clearAllFiles}
                                disabled={isProcessingQueue}
                                className="text-xs bg-red-900/40 hover:bg-red-900/60 text-red-300 border border-red-800 px-2 py-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                title="Remove All Files"
                            >
                                Clear
                            </button>
                        )}
                        {items.length > 0 && (
                            <button
                                onClick={handleTranscribeAll}
                                disabled={isProcessingQueue || !items.some(i => i.status === 'idle' || i.status === 'error')}
                                className="text-xs bg-cyan-600 hover:bg-cyan-500 text-white px-2 py-1.5 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
                            >
                                {isProcessingQueue ? 'Working...' : 'Transcribe All'}
                            </button>
                        )}
                    </div>
                </div>
                
                <div className="overflow-y-auto p-2 space-y-2 flex-grow custom-scrollbar">
                    {items.length === 0 ? (
                        <div className="text-center py-8 text-slate-500 italic text-sm">
                            No files added yet.
                        </div>
                    ) : (
                        items.map(item => (
                            <div 
                                key={item.id}
                                onClick={() => setActiveId(item.id)}
                                className={`group p-3 rounded-lg border cursor-pointer transition-all duration-200 relative ${
                                    activeId === item.id 
                                    ? 'bg-slate-700 border-cyan-500/50 ring-1 ring-cyan-500/20' 
                                    : 'bg-slate-800 border-slate-700 hover:border-slate-600'
                                }`}
                            >
                                <div className="flex justify-between items-start mb-2 pr-6">
                                    <div className="flex items-center gap-2 overflow-hidden">
                                        {item.mediaType === 'video' ? <VideoCameraIcon className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <FileAudioIcon className="w-4 h-4 text-slate-400 flex-shrink-0" />}
                                        <p className="font-medium text-sm text-slate-200 truncate">{item.file.name}</p>
                                    </div>
                                    <button onClick={(e) => removeFile(e, item.id)} className="absolute top-2 right-2 p-1 text-slate-500 hover:text-red-400 transition-colors">
                                        <TrashIcon className="w-4 h-4" />
                                    </button>
                                </div>
                                
                                <div className="flex justify-between items-center">
                                    <div className="text-xs">
                                        {item.status === 'idle' && <span className="text-slate-500">Pending</span>}
                                        {item.status === 'transcribing' && <span className="text-cyan-400 animate-pulse">Transcribing...</span>}
                                        {item.status === 'completed' && <span className="text-green-400 flex items-center gap-1"><CheckIcon className="w-3 h-3" /> Done</span>}
                                        {item.status === 'error' && <span className="text-red-400">Failed</span>}
                                    </div>
                                    {item.status !== 'transcribing' && item.status !== 'completed' && (
                                        <button 
                                            onClick={(e) => handleTranscribeSingle(e, item)}
                                            className="text-xs bg-slate-700 hover:bg-slate-600 border border-slate-600 text-slate-300 px-2 py-1 rounded transition-colors"
                                        >
                                            Start
                                        </button>
                                    )}
                                </div>
                                {item.error && <p className="text-xs text-red-400 mt-2 bg-red-900/20 p-1 rounded">{item.error}</p>}
                            </div>
                        ))
                    )}
                </div>
            </div>
          </section>

          {/* COLUMN 3: Output (5 cols) */}
          <section className="lg:col-span-5 space-y-6">
            {!activeItem ? (
                <div className="bg-slate-800/30 border border-slate-800 rounded-xl h-full flex flex-col justify-center items-center p-8 text-slate-500 min-h-[600px]">
                    <ListIcon className="w-16 h-16 opacity-20 mb-4" />
                    <p>Select a file from the queue to view details.</p>
                </div>
            ) : (
                <>
                {/* Preview Player */}
                 <div className="bg-slate-800/50 p-4 rounded-xl border border-slate-700 shadow-lg">
                    <h3 className="text-sm font-semibold text-slate-300 mb-3 uppercase tracking-wider flex items-center gap-2">
                        <PlayIcon className="w-4 h-4 text-cyan-400" /> 
                        Preview: {activeItem.file.name}
                    </h3>
                    <div className="bg-slate-900 rounded-lg overflow-hidden border border-slate-700 mx-auto w-full">
                        {activeItem.mediaType === 'video' ? (
                            <video
                                ref={videoRef}
                                src={activeMediaUrl || ''}
                                onTimeUpdate={(e) => handleTimeUpdate(e.currentTarget.currentTime)}
                                onPlay={() => setIsPlaying(true)}
                                onPause={() => setIsPlaying(false)}
                                onLoadedMetadata={(e) => setActiveDuration(e.currentTarget.duration)}
                                onEnded={() => { setIsPlaying(false); setActiveCueIndex(-1); }}
                                className="w-full h-48 sm:h-64 object-contain bg-black"
                                controls
                            />
                        ) : (
                            <div className="p-4 flex items-center justify-center flex-col gap-3">
                                <div ref={waveformContainerRef} className="w-full h-[60px]"></div>
                                {!isWaveformReady && <p className="text-slate-400 text-sm">Loading waveform...</p>}
                                {isWaveformReady && (
                                <div className="flex items-center gap-4 mt-2">
                                    <button onClick={() => wavesurferRef.current?.playPause()} className="p-2 rounded-full bg-slate-700 hover:bg-slate-600 transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-500">
                                        {isPlaying ? <PauseIcon className="w-6 h-6 text-white" /> : <PlayIcon className="w-6 h-6 text-white" />}
                                    </button>
                                    <div className="font-mono text-sm text-slate-400 bg-slate-800 px-3 py-1 rounded-md border border-slate-700">
                                        {formatPlayerTime(playerCurrentTime)} / {formatPlayerTime(activeDuration ?? 0)}
                                    </div>
                                </div>
                                )}
                            </div>
                        )}
                    </div>
                 </div>

                {/* Output Area */}
                 <div className="bg-slate-800/50 p-6 rounded-xl border border-slate-700 shadow-lg min-h-[500px] flex flex-col relative">
                    <div className="flex justify-between items-center mb-4 border-b border-slate-700 pb-3">
                        <h2 className="text-xl font-bold text-white">Transcript</h2>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={downloadVTT}
                                disabled={activeItem.status !== 'completed'}
                                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors disabled:opacity-30"
                                title="Download .vtt"
                            >
                               <DownloadIcon className="h-5 w-5" />
                            </button>
                            <button
                                onClick={copyToClipboard}
                                disabled={activeItem.status !== 'completed'}
                                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors disabled:opacity-30"
                                title="Copy Text"
                            >
                                {copied ? <CheckIcon className="h-5 w-5 text-green-400" /> : <CopyIcon className="h-5 w-5" />}
                            </button>
                        </div>
                    </div>
                    
                    <div ref={outputRef} className="flex-grow overflow-auto h-full max-h-[700px] pr-2 custom-scrollbar">
                        {activeItem.status === 'transcribing' && (
                             <div className="flex flex-col justify-center items-center h-full gap-4 min-h-[300px]">
                                <div className="flex items-center gap-1">
                                    <div className="h-4 w-4 bg-cyan-400 rounded-full animate-bounce"></div>
                                    <div className="h-4 w-4 bg-cyan-400 rounded-full animate-bounce delay-100"></div>
                                    <div className="h-4 w-4 bg-cyan-400 rounded-full animate-bounce delay-200"></div>
                                </div>
                                <p className="text-slate-400 text-lg">AI is listening & scribing...</p>
                            </div>
                        )}
                        
                        {activeItem.status === 'error' && (
                            <div className="flex flex-col justify-center items-center h-full text-center min-h-[300px]">
                                 <p className="text-red-400 mb-2 text-lg font-medium">Transcription Failed</p>
                                 <p className="text-slate-500">{activeItem.error}</p>
                            </div>
                        )}

                        {activeItem.status === 'completed' && (
                            <>
                                {activeItem.fullTranscript && !activeItem.cues.length && (
                                    <p className="whitespace-pre-wrap font-sans text-lg text-slate-300 leading-relaxed">
                                      {activeItem.fullTranscript}
                                    </p>
                                )}
                                {activeItem.cues.length > 0 && (
                                     <div className="space-y-2 font-mono text-base">
                                         {activeItem.cues.map((cue, index) => (
                                            <div key={index} data-cue-index={index} className={`flex gap-4 p-3 rounded-lg transition-all duration-200 border border-transparent ${index === activeCueIndex ? 'bg-cyan-950/40 border-cyan-500/30' : 'hover:bg-slate-800/50'}`}>
                                                <span className="text-cyan-400 text-xs opacity-70 select-none flex-shrink-0 pt-1 w-20 text-right">{formatTime(cue.start, settings.timestampFormat)}</span>
                                                <span className="font-sans text-slate-200 text-lg leading-snug">{cue.word}</span>
                                            </div>
                                         ))}
                                     </div>
                                )}
                            </>
                        )}
                        
                        {activeItem.status === 'idle' && (
                            <div className="flex flex-col justify-center items-center h-full text-slate-500 gap-6 min-h-[300px]">
                                <div className="bg-slate-800 p-4 rounded-full">
                                    <FileAudioIcon className="w-12 h-12 text-slate-600" />
                                </div>
                                <div className="text-center">
                                    <p className="text-lg font-medium text-slate-300">Ready to transcribe</p>
                                    <p className="text-sm">Click start to begin processing {activeItem.file.name}</p>
                                </div>
                                <button 
                                    onClick={(e) => handleTranscribeSingle(e, activeItem)}
                                    className="bg-cyan-600 hover:bg-cyan-500 text-white px-8 py-3 rounded-lg font-medium transition-all shadow-lg shadow-cyan-900/20 hover:shadow-cyan-500/20"
                                >
                                    Start Transcription
                                </button>
                            </div>
                        )}
                    </div>
                 </div>
                </>
            )}
          </section>
        </main>
      </div>
    </div>
  );
};

export default App;
