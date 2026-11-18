"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useGLStage } from "./GLStageProvider";
import { prefersReducedMotion, type GLItem } from "./Stage";
import { drawText, fontOf } from "./textTexture";
import { VALUE_NOISE } from "./glsl";

export type GLTextState = "in" | "out" | "hidden";
type Direction = "next" | "prev";

type Variant = {
    blob?: boolean;  // liquid mask transition, same as the image slider (the other fields are ignored)
    travel: number;  // vertical travel, in element heights ("mask") or CSS px ("fade")
    fade: boolean;   // opacity follows the motion
    stagger: number; // 0..1, part of the timeline used to delay columns from left to right (wave)
    smear: number;   // motion blur along the movement, in element heights
};

const VARIANTS = {
    // Liquid mask, same as the image slider: the leaving text disappears exactly where the entering one appears
    blob: { blob: true, travel: 0, fade: false, stagger: 0, smear: 0 },
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

// Same mask as the image slider (WebGLSlider), in px so a short title gets the same edge as the image.
// "in" draws the text inside the blob, "out" outside: two stacked titles swap exactly like two images.
const FRAGMENT_BLOB = /* glsl */ `
varying vec2 vUv;
uniform sampler2D uMap;
uniform vec2 uRes;       // quad size (CSS px)
uniform float uProgress; // 0 -> 1, linear time
uniform float uTime;
uniform float uMode;     // 1 = in, -1 = out
uniform float uDir;      // 1 = next (blob grows from the bottom), -1 = prev (from the top)

${VALUE_NOISE}

const float REF = 500.0; // px: noise / edge scale of the image slider

float ease(float t) { // same easing as the image (easeInOutCubic)
    return t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 3.0) * 0.5;
}

vec4 tap(vec2 uv) {
    float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
    return texture2D(uMap, uv) * inside;
}

void main() {
    float p = ease(uProgress);
    vec2 px = vUv * uRes;
    vec2 origin = vec2(0.5, uDir > 0.0 ? -0.15 : 1.15) * uRes;
    vec2 q = (px - origin) / REF;

    vec2 nUv = px / REF;
    // Value noise is 0..1: remapped to -1..1 so the blob keeps the same amplitude as the image
    float n = (noise(nUv * 2.2 + vec2(uTime * 0.25, -uTime * 0.35)) * 2.0 - 1.0) * 0.6
            + (noise(nUv * 5.0 - vec2(uTime * 0.4, uTime * 0.2)) * 2.0 - 1.0) * 0.25;
    float d = length(q) + n * 0.22;

    float far = length(max(origin, uRes - origin)) / REF; // farthest corner of the quad
    float r = mix(-0.35, far + 0.4, p);
    float mask = 1.0 - smoothstep(r - 0.006, r + 0.006, d);

    // Distortion band along the edge of the blob (px -> uv)
    float edge = 1.0 - smoothstep(0.0, 0.18, abs(d - r));
    vec2 toward = normalize(q + 1e-4) / uRes;

    vec2 uv;
    float alpha;
    if (uMode > 0.0) {
        // Entering: starts slightly zoomed in, pulled by the edge, visible inside the blob
        uv = (vUv - 0.5) * (1.0 - 0.06 * (1.0 - p)) + 0.5;
        uv -= toward * edge * 20.0;
        alpha = mask;
    } else {
        // Leaving: slowly zooms, pushed by the edge, visible outside the blob
        uv = (vUv - 0.5) * (1.0 - 0.04 * p) + 0.5;
        uv += toward * edge * 10.0;
        alpha = 1.0 - mask;
    }

    vec4 c = tap(uv);
    gl_FragColor = vec4(c.rgb, c.a * alpha);
    #include <colorspace_fragment>
}`;

type GLTextProps = {
    as?: "h1" | "h2" | "h3" | "h4" | "p" | "span";
    children: string;
    className?: string;
    state: GLTextState;
    direction: Direction;
    variant?: keyof typeof VARIANTS;
    delay?: number;    // ms, entering only (both ways for "blob", so in / out stay in sync)
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
            uRes: { value: new THREE.Vector2(1, 1) },
            uTime: { value: 0 },
        };
        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.ShaderMaterial({
            vertexShader: VERTEX,
            fragmentShader: config.blob ? FRAGMENT_BLOB : FRAGMENT,
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
        // (blob: the entering text is zoomed, give it room on the sides)
        const bleed = { x: fontSize * (config.blob ? 0.5 : 0.1), y: fontSize * 0.3 + (config.fade ? config.travel : 0) };

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
                uniforms.uRes.value.set(width, height);
                const travel = config.fade ? config.travel : config.travel * (height - bleed.y * 2);
                uniforms.uTravel.value = travel / height;
                uniforms.uSmear.value = (config.smear * (height - bleed.y * 2)) / height;
                redraw();
            },
            update(now) {
                if (!anim.running) return false;
                const t = Math.min(Math.max((now - anim.start) / anim.duration, 0), 1);
                uniforms.uProgress.value = t;
                uniforms.uTime.value = (now / 1000) % 1000; // same clock as the image: same noise
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
                    start: performance.now() + (mode > 0 || config.blob ? delayMs : 0),
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
