import React from 'react';
import { Scene } from '../types';
import { CheckCircle, Image as ImageIcon, AlertCircle, Clock } from 'lucide-react';

interface SceneCardProps {
  scene: Scene;
  isActive: boolean;
  onClick: () => void;
  onTimeChange: (time: number) => void;
}

export const SceneCard: React.FC<SceneCardProps> = ({ scene, isActive, onClick, onTimeChange }) => {
  // Helper to format seconds to MM:SS.ms
  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${m}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  return (
    <div 
      onClick={onClick}
      className={`relative p-3 rounded-xl border transition-all group ${
        isActive 
          ? 'bg-accent-500/10 border-accent-500 shadow-[0_0_15px_rgba(99,102,241,0.2)]' 
          : 'bg-gray-900 border-gray-800 hover:bg-gray-800'
      }`}
    >
      <div className="flex gap-3">
        {/* Thumbnail - 16:9 Aspect Ratio */}
        <div className={`w-32 h-[72px] rounded-lg flex-shrink-0 bg-gray-950 overflow-hidden border border-gray-800 relative ${isActive ? 'ring-2 ring-accent-500/30' : ''}`}>
            {scene.imageUrl ? (
                <img src={scene.imageUrl} alt={`Scene ${scene.id}`} className="w-full h-full object-cover" />
            ) : (
                <div className="w-full h-full flex items-center justify-center text-gray-700 flex-col gap-1">
                     {scene.status === 'generating_image' ? (
                         <ImageIcon className="animate-pulse text-accent-400" size={20} />
                     ) : scene.status === 'error' ? (
                         <AlertCircle className="text-red-500" size={20} />
                     ) : (
                         <ImageIcon size={20} />
                     )}
                </div>
            )}
            <div className="absolute top-0 left-0 bg-black/60 px-1.5 py-0.5 text-[10px] text-white rounded-br-md font-mono">
                #{scene.id}
            </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
            <div>
                <p className="text-xs font-medium text-gray-300 line-clamp-1 mb-1">
                    <span className="text-gray-500 mr-1">Prompt:</span> {scene.prompt}
                </p>
                <p className="text-xs text-gray-500 line-clamp-2 italic border-l-2 border-gray-700 pl-2">
                   "{scene.script}"
                </p>
            </div>
            
            {/* Timestamp Control */}
            <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-2 bg-black/30 rounded px-2 py-1 border border-gray-800" onClick={(e) => e.stopPropagation()}>
                    <Clock size={12} className="text-accent-400" />
                    <input 
                        type="number" 
                        step="0.1"
                        min="0"
                        className="bg-transparent w-16 text-xs text-white font-mono focus:outline-none"
                        value={scene.startTime}
                        onChange={(e) => onTimeChange(parseFloat(e.target.value) || 0)}
                    />
                    <span className="text-[10px] text-gray-500">{formatTime(scene.startTime)}</span>
                </div>
                {scene.status === 'ready' && <CheckCircle size={14} className="text-green-500" />}
            </div>
        </div>
      </div>
    </div>
  );
};