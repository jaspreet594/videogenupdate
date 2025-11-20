import React, { useEffect, useRef, useState } from 'react';
import { Scene, PlaybackState } from '../types';
import { Play, Pause, SkipBack, FastForward, Volume2, Radio } from 'lucide-react';

interface PlayerProps {
  scenes: Scene[];
  audioBuffer: AudioBuffer | null;
  playbackState: PlaybackState;
  currentTime: number;
  onPlayPause: () => void;
  onTimeUpdate: (time: number) => void;
  onPlaybackComplete: () => void;
  onRecordSync: () => void; // Trigger to sync next scene to current time
}

export const Player: React.FC<PlayerProps> = ({
  scenes,
  audioBuffer,
  playbackState,
  currentTime,
  onPlayPause,
  onTimeUpdate,
  onPlaybackComplete,
  onRecordSync
}) => {
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const startTimeRef = useRef<number>(0); // When the current play session started (audioCtx time)
  const startOffsetRef = useRef<number>(0); // Where in the buffer we started playing
  const rafRef = useRef<number>(0);

  const [visualizerData, setVisualizerData] = useState<Uint8Array | null>(null);

  // Determine current scene based on time
  const activeSceneIndex = scenes.reduce((bestIndex, scene, idx) => {
    return (scene.startTime <= currentTime) ? idx : bestIndex;
  }, 0);
  
  const currentScene = scenes[activeSceneIndex];
  // Determine next scene strictly by index order for Sync functionality
  const nextScene = activeSceneIndex < scenes.length - 1 ? scenes[activeSceneIndex + 1] : null;

  // Init AudioContext
  useEffect(() => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioContextRef.current = new AudioContextClass({ sampleRate: 24000 });
    
    return () => {
      audioContextRef.current?.close();
    };
  }, []);

  // Handle Play/Pause
  useEffect(() => {
    const ctx = audioContextRef.current;
    if (!ctx || !audioBuffer) return;

    if (playbackState === PlaybackState.PLAYING) {
        if (ctx.state === 'suspended') ctx.resume();

        // Create source
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        
        // Create analyser
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        
        source.connect(analyser);
        analyser.connect(ctx.destination);
        
        sourceRef.current = source;
        analyserRef.current = analyser;

        // Calculate start time
        startTimeRef.current = ctx.currentTime;
        // Clamp offset
        const offset = Math.min(startOffsetRef.current, audioBuffer.duration);
        
        source.start(0, offset);
        source.onended = () => {
            if (startOffsetRef.current >= audioBuffer.duration - 0.5) {
                onPlaybackComplete();
            }
        };

        // Start Loop
        const loop = () => {
            const elapsed = ctx.currentTime - startTimeRef.current;
            const current = offset + elapsed;
            
            if (current > audioBuffer.duration) {
                onTimeUpdate(audioBuffer.duration);
                cancelAnimationFrame(rafRef.current);
                return;
            }

            onTimeUpdate(current);
            startOffsetRef.current = current; // Track for pause

            // Visualizer
            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            analyser.getByteFrequencyData(dataArray);
            setVisualizerData(dataArray);

            rafRef.current = requestAnimationFrame(loop);
        };
        loop();

    } else {
        // Pausing
        if (sourceRef.current) {
            try { sourceRef.current.stop(); } catch(e) {}
            sourceRef.current = null;
            cancelAnimationFrame(rafRef.current);
        }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackState, audioBuffer]);

  // Seek functionality helper
  useEffect(() => {
    startOffsetRef.current = currentTime;
  }, [currentTime]);


  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-2xl overflow-hidden border border-gray-800 shadow-2xl">
      
      {/* Visual Area - Aspect Ratio 16:9 enforced via aspect-video */}
      <div className="relative w-full aspect-video bg-black flex items-center justify-center overflow-hidden mx-auto my-auto">
        
        {/* Scene Renderer - Stacked for transitions */}
        {scenes.map((scene, idx) => {
            // Optimization: Only render active, previous, and next to conserve resources
            if (Math.abs(idx - activeSceneIndex) > 1) return null;

            const isCurrent = idx === activeSceneIndex;
            const isEven = idx % 2 === 0;
            const zoomClass = isEven ? 'animate-kb-in' : 'animate-kb-out';

            return (
                <div 
                    key={scene.id}
                    className={`absolute inset-0 w-full h-full transition-opacity duration-1000 ease-in-out ${
                        isCurrent ? 'opacity-100 z-10' : 'opacity-0 z-0'
                    }`}
                >
                    {scene.imageUrl ? (
                        <>
                            {/* Blurred Background for filling gaps (optional since we are 16:9 now, but nice for style) */}
                            <div 
                                className="absolute inset-0 opacity-20 blur-3xl transform scale-125"
                                style={{ 
                                    backgroundImage: `url(${scene.imageUrl})`, 
                                    backgroundPosition: 'center', 
                                    backgroundSize: 'cover' 
                                }}
                            />
                            
                            {/* Main Image with Zoom Effect */}
                            <div className="relative w-full h-full flex items-center justify-center overflow-hidden">
                                <img 
                                    src={scene.imageUrl} 
                                    alt={`Scene ${scene.id}`} 
                                    className={`w-full h-full object-cover ${zoomClass}`}
                                />
                            </div>
                        </>
                    ) : (
                        <div className="w-full h-full flex items-center justify-center bg-gray-900 text-gray-600">
                            Generating visuals...
                        </div>
                    )}
                </div>
            );
        })}

        {/* Subtitle Overlay - Always on top (Z-20) */}
        <div className="absolute bottom-8 w-full px-12 text-center z-20 pointer-events-none">
             <div className="inline-block bg-black/80 backdrop-blur px-6 py-4 rounded-2xl border border-gray-700 shadow-xl max-w-3xl transition-all duration-300">
                <p className="text-xl text-white font-medium leading-relaxed drop-shadow-md">
                    {currentScene?.script || "..."}
                </p>
             </div>
        </div>

        {/* Recording Overlay Indicator */}
        {playbackState === PlaybackState.PLAYING && (
            <div className="absolute top-4 right-4 flex items-center gap-2 bg-black/50 backdrop-blur px-3 py-1 rounded-full border border-gray-700 z-30">
                <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                <span className="text-xs font-mono text-gray-300">
                    {Math.floor(currentTime / 60)}:{Math.floor(currentTime % 60).toString().padStart(2, '0')}
                </span>
            </div>
        )}
      </div>

      {/* Controls */}
      <div className="h-24 bg-gray-950 border-t border-gray-800 flex flex-col px-6 py-4 justify-between shrink-0 z-30">
         
         {/* Progress Bar */}
         <div className="w-full h-1.5 bg-gray-800 rounded-full mb-2 overflow-hidden relative cursor-pointer"
              onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const x = e.clientX - rect.left;
                  const percent = x / rect.width;
                  if (audioBuffer) onTimeUpdate(percent * audioBuffer.duration);
              }}
         >
            <div 
                className="absolute top-0 left-0 h-full bg-accent-500 transition-all duration-100" 
                style={{ width: `${(currentTime / (audioBuffer?.duration || 1)) * 100}%` }}
            />
            {/* Scene Markers */}
            {scenes.map((s) => (
                <div 
                    key={s.id}
                    className="absolute top-0 w-0.5 h-full bg-white/30 hover:bg-white z-10"
                    style={{ left: `${(s.startTime / (audioBuffer?.duration || 1)) * 100}%` }}
                    title={`Scene ${s.id}`}
                />
            ))}
         </div>

         <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 w-1/3">
                 {/* Visualizer Mini */}
                <div className="flex items-end gap-0.5 h-8 w-24 opacity-60">
                    {visualizerData ? Array.from(visualizerData.slice(0, 12)).map((val: number, i: number) => (
                        <div key={i} className="w-1.5 bg-accent-400 rounded-t-[1px]" style={{ height: `${(val / 255) * 100}%` }} />
                    )) : <div className="flex items-center text-xs text-gray-600"><Volume2 size={14} className="mr-1"/> Ready</div>}
                </div>
            </div>

            <div className="flex items-center justify-center gap-6 w-1/3">
                <button 
                    onClick={() => {
                         onTimeUpdate(Math.max(0, currentTime - 5));
                    }}
                    className="text-gray-400 hover:text-white p-2 transition-colors"
                >
                    <SkipBack size={20} />
                </button>

                <button 
                    onClick={onPlayPause}
                    className={`w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-all active:scale-95 ${
                        playbackState === PlaybackState.PLAYING 
                        ? 'bg-red-500 hover:bg-red-600 text-white shadow-red-900/20' 
                        : 'bg-white hover:bg-gray-100 text-black shadow-white/10'
                    }`}
                >
                    {playbackState === PlaybackState.PLAYING ? <Pause fill="currentColor" /> : <Play fill="currentColor" className="ml-1" />}
                </button>

                {/* Live Sync Button */}
                <button 
                    onClick={onRecordSync}
                    disabled={!nextScene || playbackState !== PlaybackState.PLAYING}
                    className="flex flex-col items-center gap-1 group disabled:opacity-30 transition-opacity"
                >
                    <div className="w-10 h-10 rounded-full border-2 border-accent-500 flex items-center justify-center text-accent-500 group-hover:bg-accent-500 group-hover:text-white transition-colors">
                        <Radio size={18} />
                    </div>
                    <span className="text-[10px] font-medium text-accent-500 uppercase tracking-wider">Sync Next</span>
                </button>
            </div>

            <div className="w-1/3 text-right">
                <span className="text-gray-500 text-xs font-mono">
                    SCENE {activeSceneIndex + 1} / {scenes.length}
                </span>
            </div>
         </div>
      </div>
    </div>
  );
};