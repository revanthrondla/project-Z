import { useRef, useState, useEffect, useCallback } from 'react';

/**
 * SignaturePad — HTML5 canvas-based signature capture component.
 * Props:
 *   onSave(dataURL)  — called with base64 PNG when user clicks Save
 *   onCancel()       — called when user dismisses without saving
 *   width / height   — canvas dimensions (default 520 × 180)
 */
export default function SignaturePad({ onSave, onCancel, width = 520, height = 180 }) {
  const canvasRef = useRef(null);
  const [drawing, setDrawing] = useState(false);
  const [isEmpty, setIsEmpty]  = useState(true);
  const lastPos = useRef(null);

  // ── Canvas setup ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = '#1e40af';
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width  / rect.width;
    const scaleY = canvas.height / rect.height;
    if (e.touches) {
      return {
        x: (e.touches[0].clientX - rect.left) * scaleX,
        y: (e.touches[0].clientY - rect.top)  * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top)  * scaleY,
    };
  };

  const startDraw = useCallback((e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    lastPos.current = pos;
    setDrawing(true);
    setIsEmpty(false);
  }, []);

  const draw = useCallback((e) => {
    if (!drawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
  }, [drawing]);

  const endDraw = useCallback(() => {
    setDrawing(false);
    lastPos.current = null;
  }, []);

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    setIsEmpty(true);
  };

  const save = () => {
    if (isEmpty) return;
    const dataURL = canvasRef.current.toDataURL('image/png');
    onSave(dataURL);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-gray-500">Draw your signature below:</p>

      {/* Canvas */}
      <div className="border-2 border-dashed border-blue-300 rounded-xl overflow-hidden bg-white relative"
           style={{ touchAction: 'none' }}>
        <canvas
          ref={canvasRef}
          width={width}
          height={height}
          className="w-full cursor-crosshair block"
          style={{ height: `${height}px` }}
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {isEmpty && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-300 text-sm select-none">Sign here</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={clear}
          className="text-sm text-gray-500 hover:text-red-600 underline"
        >
          Clear
        </button>
        <div className="flex gap-2">
          {onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={save}
            disabled={isEmpty}
            className={`px-5 py-2 rounded-lg text-sm font-medium text-white transition-opacity
              ${isEmpty ? 'bg-blue-300 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'}`}
          >
            Apply Signature
          </button>
        </div>
      </div>
    </div>
  );
}
