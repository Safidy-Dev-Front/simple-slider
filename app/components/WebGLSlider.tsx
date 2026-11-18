"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useGLStage } from "./gl/GLStageProvider";
import { prefersReducedMotion, type GLItem } from "./gl/Stage";

type Direction = "next" | "prev";

type WebGLSliderProps = {
    images: string[];
    active: number;
    previous: number | null;
    direction: Direction;
    duration: number; // ms
    label?: string;
};

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const FRAGMENT = /* glsl */ `
varying vec2 vUv;

uniform sampler2D uFrom;
uniform sampler2D uTo;
uniform vec2 uRes;       // element size (px)
uniform vec2 uFromSize;  // image sizes (px), for "object-fit: cover"
uniform vec2 uToSize;
uniform float uProgress; // 0 -> 1
uniform float uTime;
uniform float uDir;      // 1 = next (mask grows from the bottom), -1 = prev (from the top)

// Simplex noise 2D - Ashima Arts / Stefan Gustavson (MIT)
vec3 permute(vec3 x) { return mod(((x * 34.0) + 1.0) * x, 289.0); }
float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
    vec2 i = floor(v + dot(v, C.yy));
    vec2 x0 = v - i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod(i, 289.0);
    vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
    vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
    m = m * m; m = m * m;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
    vec3 g;
    g.x = a0.x * x0.x + h.x * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

vec2 coverUv(vec2 uv, vec2 size) {
    float rs = uRes.x / uRes.y;
    float ri = size.x / size.y;
    vec2 s = rs > ri ? vec2(1.0, ri / rs) : vec2(rs / ri, 1.0);
    return (uv - 0.5) * s + 0.5;
}

void main() {
    float aspect = uRes.x / uRes.y;

    // Liquid blob: distance to the origin, deformed by animated noise
    vec2 origin = vec2(0.5, uDir > 0.0 ? -0.15 : 1.15);
    vec2 p = vUv - origin;
    p.x *= aspect;
    float n = snoise(vUv * 2.2 + vec2(uTime * 0.25, -uTime * 0.35)) * 0.6
            + snoise(vUv * 5.0 - vec2(uTime * 0.4, uTime * 0.2)) * 0.25;
    float d = length(p) + n * 0.22;

    float maxR = length(vec2(aspect, 1.3)) + 0.4;
    float r = mix(-0.35, maxR, uProgress);
    float mask = 1.0 - smoothstep(r - 0.006, r + 0.006, d);

    // Distortion band along the edge of the blob
    float edge = 1.0 - smoothstep(0.0, 0.18, abs(d - r));
    vec2 toward = normalize(p + 1e-4) * vec2(1.0 / aspect, 1.0);

    // Incoming image: starts zoomed in, gets pulled by the edge
    vec2 toUv = (vUv - 0.5) * (1.0 - 0.18 * (1.0 - uProgress)) + 0.5;
    toUv -= toward * edge * 0.04;
    // Outgoing image: slowly zooms and gets pushed by the edge
    vec2 fromUv = (vUv - 0.5) * (1.0 - 0.08 * uProgress) + 0.5;
    fromUv += toward * edge * 0.02;

    vec4 from = texture2D(uFrom, coverUv(fromUv, uFromSize));
    vec4 to = texture2D(uTo, coverUv(toUv, uToSize));
    from.rgb *= 1.0 - 0.45 * uProgress; // darken the leaving image

    gl_FragColor = mix(from, to, mask);
    #include <colorspace_fragment>
}`;

const easeInOutCubic = (t: number) =>
    t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

type Controller = { transition: (from: number, to: number, dir: Direction) => void; show: (i: number) => void };

/** Image slider drawn by the global WebGL canvas, following the box of its placeholder div */
const WebGLSlider = ({ images, active, previous, direction, duration, label }: WebGLSliderProps) => {
    const stage = useGLStage();
    const elRef = useRef<HTMLDivElement>(null);
    const ctrlRef = useRef<Controller | null>(null);
    const activeRef = useRef(active);
    useEffect(() => {
        activeRef.current = active; // read when the item is (re)built
    });

    // Stable key so a new array with the same images does not rebuild the item
    const imagesKey = images.join("|");

    useEffect(() => {
        const sources = imagesKey.split("|");
        const uniforms = {
            uFrom: { value: null as THREE.Texture | null },
            uTo: { value: null as THREE.Texture | null },
            uRes: { value: new THREE.Vector2(1, 1) },
            uFromSize: { value: new THREE.Vector2(1, 1) },
            uToSize: { value: new THREE.Vector2(1, 1) },
            uProgress: { value: 1 },
            uTime: { value: 0 },
            uDir: { value: 1 },
        };
        const geometry = new THREE.PlaneGeometry(1, 1);
        const material = new THREE.ShaderMaterial({ vertexShader: VERTEX, fragmentShader: FRAGMENT, uniforms, depthTest: false, depthWrite: false });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = 0; // below texts
        mesh.visible = false;

        const state = { from: activeRef.current, to: activeRef.current, dir: 1, start: 0, running: false, duration };

        // The source images are much larger than the element: mipmaps avoid aliasing while they zoom / warp
        const textures: (THREE.Texture | null)[] = sources.map(() => null);
        const loader = new THREE.TextureLoader();
        let disposed = false;
        sources.forEach((src, i) => {
            loader.load(src, (texture) => {
                if (disposed) return texture.dispose();
                texture.colorSpace = THREE.SRGBColorSpace;
                texture.generateMipmaps = true;
                texture.minFilter = THREE.LinearMipmapLinearFilter;
                texture.magFilter = THREE.LinearFilter;
                texture.anisotropy = stage.maxAnisotropy;
                textures[i] = texture;
                stage.renderer?.initTexture(texture); // upload to the GPU now, not during the first transition
                stage.invalidate();
            });
        });

        const setSize = (target: THREE.Vector2, texture: THREE.Texture) => {
            const img = texture.image as { width: number; height: number };
            target.set(img.width, img.height);
        };

        const item: GLItem = {
            el: elRef.current!,
            object: mesh,
            resize(width, height) {
                uniforms.uRes.value.set(width, height);
            },
            update(now) {
                const from = textures[state.from];
                const to = textures[state.to];
                mesh.visible = !!(from && to);
                if (state.running) {
                    const t = Math.min(Math.max((now - state.start) / state.duration, 0), 1);
                    uniforms.uProgress.value = easeInOutCubic(t);
                    state.running = t < 1;
                }
                if (from && to) {
                    uniforms.uFrom.value = from;
                    uniforms.uTo.value = to;
                    setSize(uniforms.uFromSize.value, from);
                    setSize(uniforms.uToSize.value, to);
                }
                uniforms.uDir.value = state.dir;
                uniforms.uTime.value = (now / 1000) % 1000;
                return state.running;
            },
        };
        const remove = stage.add(item);

        ctrlRef.current = {
            show(i) {
                Object.assign(state, { from: i, to: i, running: false });
                uniforms.uProgress.value = 1;
                stage.invalidate();
            },
            transition(from, to, dir) {
                Object.assign(state, {
                    from,
                    to,
                    dir: dir === "next" ? 1 : -1,
                    start: performance.now(),
                    running: true,
                    duration: prefersReducedMotion() ? 1 : duration,
                });
                uniforms.uProgress.value = 0;
                stage.invalidate();
            },
        };

        return () => {
            disposed = true;
            remove();
            ctrlRef.current = null;
            textures.forEach((t) => t?.dispose());
            geometry.dispose();
            material.dispose();
        };
    }, [stage, imagesKey, duration]);

    useEffect(() => {
        const ctrl = ctrlRef.current;
        if (!ctrl) return;
        if (previous === null || previous === active) ctrl.show(active);
        else ctrl.transition(previous, active, direction);
    }, [active, previous, direction]);

    return <div ref={elRef} className="webgl-slider" role="img" aria-label={label} />;
};

export default WebGLSlider;
