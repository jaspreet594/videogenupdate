import React, { useState, useRef, useEffect } from 'react';
import { Scene, ProjectData, PlaybackState } from './types';
import { generateSceneImage, generateStoryboard, validateApiKey } from './services/geminiService';
import { getAudioContext } from './services/audioUtils';
import { renderAndExportVideo } from './services/videoRecorder';
import { SceneCard } from './components/SceneCard';
import { Player } from './components/Player';
import { Sparkles, Wand2, Upload, Music, Type, FileText, Clock, ArrowDown, Zap, PlayCircle, RotateCcw, Download, Loader2, Key, XCircle, CheckCircle, AlertCircle } from 'lucide-react';

const App: React.FC = () => {
  // Input States
  const [apiKey, setApiKey] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [keyValidationStatus, setKeyValidationStatus] = useState<'idle' | 'validating' | 'valid' | 'invalid'>('idle');
  
  const [rawStoryInput, setRawStoryInput] = useState('');
  const [isProcessingStory, setIsProcessingStory] = useState(false);

  const [promptsInput, setPromptsInput] = useState('');
  const [scriptInput, setScriptInput] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  
  // App Logic States
  const [project, setProject] = useState<ProjectData | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [playbackState, setPlaybackState] = useState<PlaybackState>(PlaybackState.IDLE);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  
  // Export States
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);

  const audioCtxRef = useRef<AudioContext | null>(null);

  // Load and Validate API Key on mount
  useEffect(() => {
    const initializeKey = async () => {
        const storedKey = localStorage.getItem('gemini_api_key') || process.env.API_KEY;
        if (storedKey) {
            setKeyInput(storedKey);
            setKeyValidationStatus('validating');
            const isValid = await validateApiKey(storedKey);
            if (isValid) {
                setApiKey(storedKey);
                setKeyValidationStatus('valid');
            } else {
                setKeyValidationStatus('invalid');
            }
        }
    };
    initializeKey();
  }, []);

  const handleKeyInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setKeyInput(e.target.value);
    // Reset status to idle when typing if it was previously invalid/valid to show it's dirty
    if (keyValidationStatus !== 'idle') setKeyValidationStatus('idle');
  };

  const handleSetKey = async () => {
    if (!keyInput.trim()) return;
    
    setKeyValidationStatus('validating');
    const isValid = await validateApiKey(keyInput);
    
    if (isValid) {
      setApiKey(keyInput);
      localStorage.setItem('gemini_api_key', keyInput);
      setKeyValidationStatus('valid');
      setError(null);
    } else {
      setKeyValidationStatus('invalid');
      // Optionally clear the active key if the new one is invalid
      // setApiKey(''); 
    }
  };

  const getCtx = () => {
    if (!audioCtxRef.current) audioCtxRef.current = getAudioContext();
    return audioCtxRef.current;
  };

  const handleAudioUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setAudioFile(e.target.files[0]);
    }
  };

  const handleSmartGenerate = async () => {
    if (!rawStoryInput.trim()) {
      setError("Please enter a raw story first.");
      return;
    }
    if (!apiKey) {
      setError("API Key missing or invalid. Please set a valid key in the top right.");
      return;
    }

    setError(null);
    setIsProcessingStory(true);

    try {
      const segments = await generateStoryboard(rawStoryInput, apiKey);
      
      const scriptLines = segments.map(s => s.script).join('\n');
      const promptLines = segments.map(s => s.prompt).join('\n');

      setScriptInput(scriptLines);
      setPromptsInput(promptLines);
      setRawStoryInput(''); // Clear raw input to show it moved down
    } catch (e: any) {
      setError("Failed to generate storyboard: " + e.message);
    } finally {
      setIsProcessingStory(false);
    }
  };

  const initializeProject = async () => {
    if (!promptsInput.trim() || !scriptInput.trim() || !audioFile) {
      setError("Please fill in all 3 boxes: Prompts, Script, and Audio.");
      return;
    }
    if (!apiKey) {
      setError("API Key missing or invalid. Please set a valid key in the top right.");
      return;
    }

    setError(null);
    setIsGenerating(true);

    try {
      // 1. Parse Inputs
      const prompts = promptsInput.split('\n').filter(line => line.trim() !== '');
      const scripts = scriptInput.split('\n').filter(line => line.trim() !== '');

      if (prompts.length !== scripts.length) {
        throw new Error(`Mismatch: ${prompts.length} prompts vs ${scripts.length} script lines. They must act as pairs.`);
      }

      // 2. Decode Audio
      const ctx = getCtx();
      const arrayBuffer = await audioFile.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      // 3. Create Scene Objects (Default Timestamps: Evenly distributed)
      const interval = audioBuffer.duration / prompts.length;
      
      const initialScenes: Scene[] = prompts.map((prompt, idx) => ({
        id: idx + 1,
        prompt: prompt.trim(),
        script: scripts[idx].trim(),
        status: 'pending',
        startTime: idx * interval
      }));

      const newProject: ProjectData = {
        scenes: initialScenes,
        audioBuffer: audioBuffer,
        duration: audioBuffer.duration
      };

      setProject(newProject);
      
      // 4. Start generating images in background
      generateVisuals(newProject, apiKey);

    } catch (err: any) {
      setError(err.message);
      setProject(null);
    } finally {
      setIsGenerating(false);
    }
  };

  const generateVisuals = async (currentProject: ProjectData, key: string) => {
    const scenes = [...currentProject.scenes];
    
    // Process sequentially to avoid rate limits
    for (let i = 0; i < scenes.length; i++) {
      try {
        // Update status
        setProject(prev => {
           if (!prev) return null;
           const updated = [...prev.scenes];
           updated[i].status = 'generating_image';
           return { ...prev, scenes: updated };
        });

        const imageUrl = await generateSceneImage(scenes[i].prompt, key);

        setProject(prev => {
            if (!prev) return null;
            const updated = [...prev.scenes];
            updated[i].imageUrl = imageUrl;
            updated[i].status = 'ready';
            return { ...prev, scenes: updated };
         });

      } catch (e) {
         console.error(e);
         setProject(prev => {
            if (!prev) return null;
            const updated = [...prev.scenes];
            updated[i].status = 'error';
            return { ...prev, scenes: updated };
         });
      }
    }
  };

  const handlePlayPause = () => {
    if (playbackState === PlaybackState.PLAYING) {
        setPlaybackState(PlaybackState.PAUSED);
    } else {
        setPlaybackState(PlaybackState.PLAYING);
    }
  };

  const handleTimeChange = (id: number, newTime: number) => {
      if (!project) return;
      const newScenes = project.scenes.map(s => s.id === id ? { ...s, startTime: newTime } : s);
      setProject({ ...project, scenes: newScenes });
  };

  const handleAutoAlign = () => {
    if (!project) return;
    const interval = project.duration / project.scenes.length;
    const newScenes = project.scenes.map((s, idx) => ({
        ...s,
        startTime: idx * interval
    }));
    setProject({ ...project, scenes: newScenes });
  };

  const handleRecordSync = () => {
      if (!project) return;
      
      // Finds the first scene that is set to start in the future
      const nextSceneIndex = project.scenes.findIndex(s => s.startTime > currentTime);
      
      // If found, snap it to current time
      if (nextSceneIndex !== -1) {
          const newScenes = [...project.scenes];
          // Ensure we don't accidentally sync it BEFORE the previous scene (simple validation)
          const prevSceneTime = nextSceneIndex > 0 ? newScenes[nextSceneIndex - 1].startTime : 0;
          
          if (currentTime >= prevSceneTime) {
            newScenes[nextSceneIndex].startTime = currentTime;
            setProject({ ...project, scenes: newScenes });
          }
      }
  };

  const handleExportVideo = async () => {
    if (!project) return;
    
    // Pause playback if running
    setPlaybackState(PlaybackState.PAUSED);
    
    setIsExporting(true);
    setExportProgress(0);
    
    try {
        await renderAndExportVideo(project, (progress) => {
            setExportProgress(progress);
        });
    } catch (e: any) {
        alert("Export failed: " + e.message);
    } finally {
        setIsExporting(false);
    }
  };

  // If project exists, we show the "Studio" view. If not, the "Setup" view.
  return (
    <div className="min-h-screen flex flex-col h-screen bg-gray-950 text-gray-100 relative">
      
      {/* Export Overlay */}
      {isExporting && (
          <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex flex-col items-center justify-center">
              <div className="bg-gray-900 p-8 rounded-2xl border border-gray-800 shadow-2xl max-w-md w-full text-center">
                  <Loader2 className="animate-spin w-12 h-12 text-indigo-500 mx-auto mb-4" />
                  <h3 className="text-xl font-bold text-white mb-2">Rendering Video...</h3>
                  <p className="text-gray-400 text-sm mb-6">Please wait while we capture your story. Do not close the tab.</p>
                  
                  <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-300"
                        style={{ width: `${exportProgress}%` }}
                      />
                  </div>
                  <p className="text-right text-xs text-gray-500 mt-2 font-mono">{Math.round(exportProgress)}%</p>
              </div>
          </div>
      )}

      {/* Header */}
      <header className="h-14 bg-gray-900 border-b border-gray-800 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-2" onClick={() => !isExporting && setProject(null)}>
            <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-lg flex items-center justify-center cursor-pointer">
                <Sparkles className="text-white w-4 h-4" />
            </div>
            <h1 className="text-lg font-bold tracking-tight cursor-pointer hover:text-gray-300">StorySync <span className="text-indigo-400">Studio</span></h1>
        </div>
        <div className="flex items-center gap-4">
            
            {/* API Key Input */}
            <div className="flex items-center gap-2 bg-gray-800 rounded-md px-3 py-1.5 border border-gray-700 focus-within:border-indigo-500 transition-colors">
                <Key size={14} className="text-gray-400" />
                <input
                    type="password"
                    placeholder="Paste Gemini API Key"
                    className="bg-transparent border-none text-xs text-white focus:outline-none w-40 placeholder-gray-500 font-mono"
                    value={keyInput}
                    onChange={handleKeyInputChange}
                    onKeyDown={(e) => e.key === 'Enter' && handleSetKey()}
                />
                <button 
                    onClick={handleSetKey}
                    disabled={keyValidationStatus === 'validating'}
                    className="text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded transition-colors font-medium disabled:opacity-50"
                >
                    {keyValidationStatus === 'validating' ? '...' : 'Set'}
                </button>
                
                {/* Validation Status Indicator */}
                <div className="w-4 h-4 flex items-center justify-center">
                    {keyValidationStatus === 'validating' && (
                        <Loader2 className="animate-spin text-yellow-500" size={14} />
                    )}
                    {keyValidationStatus === 'valid' && (
                        <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]" title="Key Valid"></div>
                    )}
                    {keyValidationStatus === 'invalid' && (
                        <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" title="Key Invalid"></div>
                    )}
                    {keyValidationStatus === 'idle' && keyInput && (
                        <div className="w-2 h-2 rounded-full bg-gray-600" title="Unverified"></div>
                    )}
                </div>
            </div>

            {project && (
                <>
                 <div className="text-xs text-gray-500 font-mono bg-gray-900 px-3 py-1 rounded-full border border-gray-800">
                    Duration: {Math.floor(project.duration)}s
                 </div>
                 <button 
                    onClick={handleExportVideo}
                    disabled={isExporting}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-3 py-1.5 rounded-md font-medium transition-colors"
                 >
                    <Download size={14} /> Export Video
                 </button>
                 </>
            )}
        </div>
      </header>

      <main className="flex-1 overflow-hidden flex">
        
        {!project ? (
            /* --- SETUP VIEW --- */
            <div className="w-full max-w-5xl mx-auto p-8 overflow-y-auto">
                <div className="text-center mb-8">
                    <h2 className="text-3xl font-bold text-white mb-2">Create New Story</h2>
                    <p className="text-gray-400">Transform your text into a synchronized audio-visual experience.</p>
                </div>

                {/* AUTO-GENERATE SECTION */}
                <div className="bg-gray-900/60 border border-gray-800 rounded-2xl p-6 mb-8 relative overflow-hidden group">
                    <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/5 to-purple-500/5 pointer-events-none" />
                    <div className="relative flex flex-col gap-4">
                        <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 text-indigo-300 font-medium text-sm">
                                <Zap size={16} className="text-yellow-400" /> 
                                Smart Auto-Fill: Paste your raw story here
                            </label>
                            <span className="text-xs text-gray-500">Gemini will split it into script lines & image prompts</span>
                        </div>
                        <div className="flex gap-4">
                            <textarea 
                                className="flex-1 bg-gray-950 border border-gray-700 rounded-xl p-4 text-sm resize-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent h-24"
                                placeholder="Paste a raw story block here (e.g. 'The knight walked into the dark cave. He saw a dragon sleeping...')"
                                value={rawStoryInput}
                                onChange={e => setRawStoryInput(e.target.value)}
                            />
                            <button 
                                onClick={handleSmartGenerate}
                                disabled={isProcessingStory || !rawStoryInput.trim()}
                                className="bg-indigo-600 text-white px-6 rounded-xl font-bold text-sm hover:bg-indigo-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex flex-col items-center justify-center gap-2 w-48 shadow-lg shadow-indigo-900/20"
                            >
                                {isProcessingStory ? (
                                    <>
                                        <Wand2 className="animate-spin" size={20} />
                                        <span>Processing...</span>
                                    </>
                                ) : (
                                    <>
                                        <Sparkles size={20} />
                                        <span>Generate Breakdown</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>

                <div className="flex items-center justify-center mb-8 text-gray-600">
                    <ArrowDown size={24} className="animate-bounce" />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 h-[400px]">
                    {/* Box 1: Prompts */}
                    <div className="flex flex-col gap-2 h-full">
                        <div className="flex items-center gap-2 text-indigo-400 font-medium text-sm mb-1">
                            <Type size={16} /> 1. Image Prompts
                        </div>
                        <textarea 
                            className="flex-1 bg-gray-900/50 border border-gray-700 rounded-xl p-4 text-sm resize-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent font-mono text-xs leading-relaxed"
                            placeholder={"Line 1: Whiteboard illustration on a clean white background...\nLine 2: Whiteboard illustration on a clean white background..."}
                            value={promptsInput}
                            onChange={e => setPromptsInput(e.target.value)}
                        />
                        <span className="text-xs text-gray-500 text-right">{promptsInput.split('\n').filter(l => l.trim()).length} items</span>
                    </div>

                    {/* Box 2: Script */}
                    <div className="flex flex-col gap-2 h-full">
                        <div className="flex items-center gap-2 text-pink-400 font-medium text-sm mb-1">
                            <FileText size={16} /> 2. Script / Subtitles
                        </div>
                        <textarea 
                            className="flex-1 bg-gray-900/50 border border-gray-700 rounded-xl p-4 text-sm resize-none focus:ring-2 focus:ring-pink-500 focus:border-transparent font-mono text-xs leading-relaxed"
                            placeholder={"Line 1: It was the year 2077.\nLine 2: Shadows lurked everywhere."}
                            value={scriptInput}
                            onChange={e => setScriptInput(e.target.value)}
                        />
                        <span className="text-xs text-gray-500 text-right">{scriptInput.split('\n').filter(l => l.trim()).length} items</span>
                    </div>

                    {/* Box 3: Audio */}
                    <div className="flex flex-col gap-2 h-full">
                        <div className="flex items-center gap-2 text-emerald-400 font-medium text-sm mb-1">
                            <Music size={16} /> 3. Audio Track
                        </div>
                        <div className="flex-1 border-2 border-dashed border-gray-800 rounded-xl hover:bg-gray-900/50 hover:border-gray-600 transition-colors flex flex-col items-center justify-center relative group cursor-pointer">
                            <input 
                                type="file" 
                                accept="audio/*" 
                                onChange={handleAudioUpload}
                                className="absolute inset-0 opacity-0 cursor-pointer z-10"
                            />
                            <div className="bg-gray-800 p-4 rounded-full mb-3 group-hover:scale-110 transition-transform">
                                <Upload className="text-gray-400" size={24} />
                            </div>
                            <p className="text-gray-300 text-sm font-medium">{audioFile ? audioFile.name : "Drop audio file or click"}</p>
                            <p className="text-gray-600 text-xs mt-1">MP3, WAV supported</p>
                        </div>
                    </div>
                </div>

                <div className="mt-8 flex flex-col items-center">
                    {error && <p className="text-red-400 text-sm mb-4 bg-red-400/10 px-4 py-2 rounded-lg">{error}</p>}
                    <button 
                        onClick={initializeProject}
                        disabled={isGenerating}
                        className="bg-white text-black px-10 py-4 rounded-full font-bold text-lg hover:scale-105 transition-transform disabled:opacity-50 flex items-center gap-3 shadow-xl shadow-white/10"
                    >
                        {isGenerating ? <Wand2 className="animate-spin" /> : <PlayCircle fill="currentColor" className="text-black" />}
                        Initialize Studio
                    </button>
                </div>
            </div>
        ) : (
            /* --- STUDIO VIEW --- */
            <>
                {/* Left Panel: Scene List */}
                <div className="w-[400px] border-r border-gray-800 bg-gray-900/30 flex flex-col">
                    <div className="p-4 border-b border-gray-800 flex items-center justify-between bg-gray-900/80 backdrop-blur z-10">
                        <h3 className="font-bold text-gray-300 flex items-center gap-2">
                            <Clock size={16} /> Timeline
                        </h3>
                        <button 
                            onClick={handleAutoAlign}
                            className="text-[10px] flex items-center gap-1 bg-gray-800 hover:bg-gray-700 text-gray-300 px-2 py-1 rounded border border-gray-700 transition-colors"
                            title="Evenly distribute scenes across audio duration"
                        >
                            <RotateCcw size={10} /> Auto-Align
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                        {project.scenes.map((scene, idx) => (
                            <SceneCard 
                                key={scene.id}
                                scene={scene}
                                isActive={currentTime >= scene.startTime && (!project.scenes[idx + 1] || currentTime < project.scenes[idx + 1].startTime)}
                                onClick={() => {
                                    setCurrentTime(scene.startTime);
                                    setPlaybackState(PlaybackState.PAUSED);
                                }}
                                onTimeChange={(t) => handleTimeChange(scene.id, t)}
                            />
                        ))}
                    </div>
                    {/* Footer Instruction */}
                    <div className="p-4 bg-gray-950 border-t border-gray-800 text-[10px] text-gray-500 leading-relaxed">
                        <strong>Tip:</strong> Play audio and click <span className="text-accent-400 border border-accent-400/30 px-1 rounded">SYNC NEXT</span> to set the next scene's start time to the current playback position.
                    </div>
                </div>

                {/* Right Panel: Player */}
                <div className="flex-1 p-6 bg-gray-950 relative flex flex-col justify-center">
                     {/* Background glow */}
                    <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-600/5 rounded-full blur-[150px] pointer-events-none" />
                    
                    <div className="h-full z-10 relative w-full max-w-5xl mx-auto">
                        <Player 
                            scenes={project.scenes}
                            audioBuffer={project.audioBuffer}
                            playbackState={playbackState}
                            currentTime={currentTime}
                            onPlayPause={handlePlayPause}
                            onTimeUpdate={(t) => setCurrentTime(t)}
                            onPlaybackComplete={() => setPlaybackState(PlaybackState.COMPLETED)}
                            onRecordSync={handleRecordSync}
                        />
                    </div>
                </div>
            </>
        )}

      </main>
    </div>
  );
};

export default App;