"use client";

import { createContext, use, useEffect, useRef, useState } from "react";
import { GLStage } from "./Stage";

const GLStageContext = createContext<GLStage | null>(null);

/** Global WebGL canvas (fixed, full viewport, click-through) shared by every WebGL element of the page */
export default function GLStageProvider({ children }: { children: React.ReactNode }) {
    // Created during render (no WebGL yet) so children can register before the canvas is mounted
    const [stage] = useState(() => new GLStage());
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        stage.mount(canvasRef.current!);
        return () => stage.unmount();
    }, [stage]);

    return (
        <GLStageContext value={stage}>
            {children}
            <canvas ref={canvasRef} className="gl-stage" aria-hidden="true" />
        </GLStageContext>
    );
}

export function useGLStage() {
    const stage = use(GLStageContext);
    if (!stage) throw new Error("useGLStage must be used inside <GLStageProvider>");
    return stage;
}
