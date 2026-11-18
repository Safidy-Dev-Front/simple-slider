"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useGLStage } from "./GLStageProvider";
import { prefersReducedMotion, type GLItem } from "./Stage";
import { drawText, fontOf } from "./textTexture";

export type GLTextState = "in" | "out" | "hidden";
type Direction = "next" | "prev";

type Variant = {
    travel: number;  // vertical travel, in element heights ("mask") or CSS px ("fade")
    fade: boolean;   // opacity follows the motion
    stagger: number; // 0..1, part of the timeline used to delay columns from left to right (wave)
    smear: number;   // motion blur along the movement, in element heights
};

const VARIANTS = {
    // Slides inside its own box (the quad clips it, like overflow: hidden): titles
    mask: { travel: 1.4, fade: false, stagger: 0.35, smear: 0.25 },
    // Short slide + fade (paragraphs)
    fade: { travel: 30, fade: true, stagger: 0.25, smear: 0 },
} satisfies Record<string, Variant>;

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uMap;
uniform float uProgress; // 0 -> 1, linear time
uniform float uMode;     // 1 = in, -1 = out
uniform float uDir;      // 1 = next (moves up), -1 = prev (moves down)
uniform float uTravel;   // in uv units
uniform float uFade;
uniform float uStagger;
uniform float uSmear;    // in uv units

float ease(float t) { // ~ cubic-bezier(0.77, 0, 0.175, 1)
    return t < 0.5 ? 8.0 * t * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 4.0) * 0.5;
}

vec4 tap(vec2 uv) {
    vec4 c = texture2D(uMap, uv);
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    return vec4(c.rgb * c.a, c.a) * inside; // premultiplied, so averaging taps keeps clean edges
}

void main() {
    // Each column starts a bit later than the one on its left: a wave through the letters
    float t = clamp(uProgress * (1.0 + uStagger) - vUv.x * uStagger, 0.0, 1.0);
    float e = ease(t);
    float speed = (ease(min(t + 0.01, 1.0)) - ease(max(t - 0.01, 0.0))) / 0.02 * 0.25; // 0..1

    float offset = uMode > 0.0 ? 1.0 - e : -e;
    vec2 uv = vec2(vUv.x, vUv.y + offset * uTravel * uDir);

    // Motion blur along the movement, stronger at full speed
    float smear = speed * uSmear * uDir;
    vec4 col = vec4(0.0);
    for (int i = 0; i < 5; i++) col += tap(uv + vec2(0.0, (float(i) / 4.0 - 0.5) * smear));
    col /= 5.0;

    float alpha = col.a;
    if (uFade > 0.5) alpha *= uMode > 0.0 ? e : 1.0 - e;

    gl_FragColor = vec4(col.rgb / max(col.a, 1e-4), alpha);
    #include <colorspace_fragment>
}`;

type GLTextProps = {
    as?: "h1" | "h2" | "h3" | "h4" | "p" | "span";
    children: string;
    className?: string;
    state: GLTextState;
    direction: Direction;
    variant?: keyof typeof VARIANTS;
    delay?: number;    // ms, entering only
    duration?: number; // ms
};

type Controller = { set(state: GLTextState): void; play(state: GLTextState, dir: Direction, delay: number): void };

/**
 * Text rendered by the global WebGL canvas.
 * The DOM element keeps the layout, SEO and accessibility; it becomes invisible (.gl-text)
 * once its WebGL copy is drawn. Without WebGL, the DOM text simply stays visible.
 */
export default function GLText({ as = "p", children, className, state, direction, variant = "mask", delay = 0, duration = 900 }: GLTextProps) {
    const stage = useGLStage();
    const ref = useRef<HTMLElement>(null);
    const ctrlRef = useRef<Controller | null>(null);
    const lastState = useRef<GLTextState | null>(null);

    useEffect(() => {
        const el = ref.current!;
        const config: Variant = VARIANTS[variant];
        const canvas = document.createElement("canvas");
        const texture = new THREE.CanvasTexture(canvas);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.generateMipmaps = false; // drawn at the exact displayed resolution
        texture.minFilter = THREE.LinearFilter;

        const uniforms = {
            uMap: { value: texture },
            uProgress: { value: 1 },
            uMode: { value: 1 },
            uDir: { value: 1 },
            uTravel: { value: 0 },
            uFade: { value: config.fade ? 1 : 0 },
            uStagger: { value: config.stagger },
            uSmear: { value: 0 },
        };
        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.ShaderMaterial({
            vertexShader: VERTEX,
            fragmentShader: FRAGMENT,
            uniforms,
            transparent: true,
            depthTest: false,
            depthWrite: false,
        });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = 1; // above images
        mesh.visible = false;

        // Room for glyphs taller than the line box (line-height: 1) and for the "fade" travel
        const fontSize = parseFloat(getComputedStyle(el).fontSize);
        const bleed = { x: fontSize * 0.1, y: fontSize * 0.3 + (config.fade ? config.travel : 0) };

        const anim = { running: false, start: 0, duration, mode: 1 };
        let drawn = false;
        let size = { width: 0, height: 0, pixelRatio: 1 };

        const redraw = () => {
            if (!size.width) return;
            drawText(canvas, el, size.width, size.height, size.pixelRatio, bleed);
            texture.dispose(); // canvas size may have changed: re-allocate the GPU texture
            texture.needsUpdate = true;
            if (!drawn) {
                drawn = true;
                el.classList.add("gl-text"); // hide the DOM copy only once the WebGL one exists
            }
        };

        const item: GLItem = {
            el,
            object: mesh,
            bleed,
            resize(width, height, pixelRatio) {
                size = { width, height, pixelRatio };
                const travel = config.fade ? config.travel : config.travel * (height - bleed.y * 2);
                uniforms.uTravel.value = travel / height;
                uniforms.uSmear.value = (config.smear * (height - bleed.y * 2)) / height;
                redraw();
            },
            update(now) {
                if (!anim.running) return false;
                const t = Math.min(Math.max((now - anim.start) / anim.duration, 0), 1);
                uniforms.uProgress.value = t;
                if (t < 1) return true;
                anim.running = false;
                if (anim.mode < 0) mesh.visible = false;
                return false;
            },
        };
        const remove = stage.add(item);

        // Web fonts may arrive after the first draw
        let alive = true;
        document.fonts.load(fontOf(el)).then(() => {
            if (!alive) return;
            redraw();
            stage.invalidate();
        });

        ctrlRef.current = {
            set(s) {
                anim.running = false;
                mesh.visible = s === "in";
                uniforms.uProgress.value = 1;
                uniforms.uMode.value = 1;
                stage.invalidate();
            },
            play(s, dir, delayMs) {
                if (s === "hidden") return this.set(s);
                const mode = s === "in" ? 1 : -1;
                Object.assign(anim, {
                    running: true,
                    mode,
                    start: performance.now() + (mode > 0 ? delayMs : 0),
                    duration: prefersReducedMotion() ? 1 : duration,
                });
                uniforms.uMode.value = mode;
                uniforms.uDir.value = dir === "next" ? 1 : -1;
                uniforms.uProgress.value = 0;
                mesh.visible = true;
                stage.invalidate();
            },
        };

        return () => {
            alive = false;
            remove();
            ctrlRef.current = null;
            el.classList.remove("gl-text");
            texture.dispose();
            geometry.dispose();
            material.dispose();
        };
    }, [stage, variant, duration]);

    useEffect(() => {
        const ctrl = ctrlRef.current;
        if (!ctrl) return;
        // First render (or StrictMode re-run): show the state without animating
        if (lastState.current === null || lastState.current === state) ctrl.set(state);
        else ctrl.play(state, direction, delay);
        lastState.current = state;
    }, [state, direction, delay]);

    const Tag = as;
    return <Tag ref={ref as React.Ref<HTMLHeadingElement & HTMLParagraphElement>} className={className}>{children}</Tag>;
}
