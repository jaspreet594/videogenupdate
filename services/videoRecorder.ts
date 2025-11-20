import { ProjectData, Scene } from '../types';

// Helper to wrap text for canvas
function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(' ');
  let line = '';
  const lines = [];

  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    const metrics = ctx.measureText(testLine);
    const testWidth = metrics.width;
    if (testWidth > maxWidth && n > 0) {
      lines.push(line);
      line = words[n] + ' ';
    } else {
      line = testLine;
    }
  }
  lines.push(line);

  // Draw lines centered
  for (let k = 0; k < lines.length; k++) {
    ctx.fillText(lines[k], x, y + (k * lineHeight));
  }
}

export const renderAndExportVideo = async (
  project: ProjectData,
  onProgress: (progress: number) => void
): Promise<void> => {
  return new Promise(async (resolve, reject) => {
    try {
      // 1. Setup Canvas
      const width = 1920;
      const height = 1080;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      
      if (!ctx) throw new Error("Could not create canvas context");

      // 2. Preload Images
      const imageAssets: Record<number, HTMLImageElement> = {};
      const loadPromises = project.scenes.map(scene => {
        return new Promise<void>((resolveImg, rejectImg) => {
          if (!scene.imageUrl) {
            resolveImg();
            return;
          }
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            imageAssets[scene.id] = img;
            resolveImg();
          };
          img.onerror = () => {
             // If image fails, we just won't draw it
             resolveImg(); 
          };
          img.src = scene.imageUrl;
        });
      });

      await Promise.all(loadPromises);

      // 3. Setup Audio & Recording
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 44100 });
      const dest = audioCtx.createMediaStreamDestination();
      
      // Create Source Node
      const sourceNode = audioCtx.createBufferSource();
      if (project.audioBuffer) {
        // We need to re-decode or copy the buffer for the new context if sample rates differ, 
        // but mostly simply creating a buffer with data works or just using the existing buffer 
        // if contexts are compatible. To be safe with different contexts:
        const newBuffer = audioCtx.createBuffer(
            project.audioBuffer.numberOfChannels,
            project.audioBuffer.length,
            project.audioBuffer.sampleRate
        );
        for(let ch=0; ch < project.audioBuffer.numberOfChannels; ch++) {
            newBuffer.copyToChannel(project.audioBuffer.getChannelData(ch), ch);
        }
        sourceNode.buffer = newBuffer;
      }
      
      sourceNode.connect(dest);
      // We generally do NOT connect to destination (speakers) during export to keep it silent
      // sourceNode.connect(audioCtx.destination); 

      // 4. Init MediaRecorder
      const canvasStream = canvas.captureStream(30); // 30 FPS
      const combinedStream = new MediaStream([
        ...canvasStream.getVideoTracks(),
        ...dest.stream.getAudioTracks()
      ]);

      const recorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp9,opus'
      });

      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'story-sync-export.webm';
        a.click();
        URL.revokeObjectURL(url);
        audioCtx.close();
        resolve();
      };

      // 5. Animation Loop
      recorder.start();
      sourceNode.start(0);
      const startTime = audioCtx.currentTime;
      const duration = project.duration;

      const drawFrame = () => {
        const currentTime = audioCtx.currentTime - startTime;
        onProgress(Math.min(100, (currentTime / duration) * 100));

        if (currentTime >= duration) {
          recorder.stop();
          sourceNode.stop();
          return;
        }

        // Clear
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);

        // Find Scene
        const activeSceneIndex = project.scenes.reduce((bestIndex, scene, idx) => {
            return (scene.startTime <= currentTime) ? idx : bestIndex;
        }, 0);
        const scene = project.scenes[activeSceneIndex];
        
        // Next scene time (or end of duration) to calculate progress
        const nextStartTime = activeSceneIndex < project.scenes.length - 1 
            ? project.scenes[activeSceneIndex + 1].startTime 
            : duration;
        
        const sceneDuration = nextStartTime - scene.startTime;
        const sceneProgress = Math.max(0, Math.min(1, (currentTime - scene.startTime) / sceneDuration));

        // Draw Image with Ken Burns
        const img = imageAssets[scene.id];
        if (img) {
            ctx.save();
            
            // Logic: Even scenes Zoom In, Odd scenes Zoom Out
            const isEven = activeSceneIndex % 2 === 0;
            let scale = 1;
            
            if (isEven) {
                // Zoom In: 1.0 -> 1.25
                scale = 1 + (0.25 * sceneProgress);
            } else {
                // Zoom Out: 1.25 -> 1.0
                scale = 1.25 - (0.25 * sceneProgress);
            }

            // Translate to center, scale, translate back
            ctx.translate(width / 2, height / 2);
            ctx.scale(scale, scale);
            ctx.translate(-width / 2, -height / 2);

            // Draw image covering canvas (aspect fill)
            const imgRatio = img.width / img.height;
            const canvasRatio = width / height;
            let renderW, renderH, offsetX, offsetY;

            if (imgRatio > canvasRatio) {
                renderH = height;
                renderW = height * imgRatio;
                offsetY = 0;
                offsetX = (width - renderW) / 2;
            } else {
                renderW = width;
                renderH = width / imgRatio;
                offsetX = 0;
                offsetY = (height - renderH) / 2;
            }

            ctx.drawImage(img, offsetX, offsetY, renderW, renderH);
            ctx.restore();
        }

        // Draw Subtitles
        if (scene.script) {
            // Semi-transparent background
            const fontSize = 48;
            ctx.font = `500 ${fontSize}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            
            const textX = width / 2;
            const textY = height - 150;
            const maxWidth = width - 200;
            
            // Estimate height for background
            // Simple estimation: 2 lines approx
            // For better visuals, we just draw a generic box at the bottom or text shadow
            // Let's use text shadow for cleaner look akin to player
            
            ctx.shadowColor = "rgba(0,0,0,0.8)";
            ctx.shadowBlur = 4;
            ctx.shadowOffsetX = 2;
            ctx.shadowOffsetY = 2;
            
            ctx.fillStyle = "white";
            wrapText(ctx, scene.script, textX, textY, maxWidth, fontSize * 1.2);
            
            // Reset shadow
            ctx.shadowColor = "transparent";
        }

        requestAnimationFrame(drawFrame);
      };

      requestAnimationFrame(drawFrame);

    } catch (e) {
      reject(e);
    }
  });
};