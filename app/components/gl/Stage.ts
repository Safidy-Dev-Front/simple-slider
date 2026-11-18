import * as THREE from "three";

/**
 * Something drawn by the global WebGL canvas, glued to a DOM element.
 * The DOM element keeps the layout (and the accessibility), WebGL draws on top of it.
 */
export type GLItem = {
    /** DOM element whose box the object follows */
    el: HTMLElement;
    /** Object drawn by the stage, built at unit size (1x1): the stage scales it to the element's box */
    object: THREE.Object3D;
    /** Extra space around the element (CSS px), e.g. so glyphs or motion are not clipped */
    bleed?: { x: number; y: number };
    /** Called when the drawn size (CSS px, bleed included) or the pixel ratio changes */
    resize?(width: number, height: number, pixelRatio: number): void;
    /** Advances the item's animations. Returns true while it still needs frames */
    update?(now: number): boolean;
};

type Entry = { item: GLItem; group: THREE.Group; width: number; height: number; pixelRatio: number };

/**
 * One renderer / one canvas for the whole page.
 * - Renders on demand: nothing runs while nothing moves (no idle rAF loop)
 * - Each item follows its DOM element (scroll, resize, layout changes)
 * - Items outside the viewport are skipped
 */
export class GLStage {
    readonly scene = new THREE.Scene();
    readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    renderer: THREE.WebGLRenderer | null = null;

    private entries = new Map<GLItem, Entry>();
    private raf = 0;
    private width = 1;
    private height = 1;
    private observer: ResizeObserver | null = null;

    get maxAnisotropy() {
        return this.renderer?.capabilities.getMaxAnisotropy() ?? 1;
    }

    /** Registers an item; returns the function that removes it */
    add(item: GLItem) {
        const group = new THREE.Group();
        group.add(item.object);
        this.scene.add(group);
        this.entries.set(item, { item, group, width: 0, height: 0, pixelRatio: 0 });
        this.observer?.observe(item.el);
        this.invalidate();
        return () => {
            this.entries.delete(item);
            this.scene.remove(group);
            this.observer?.unobserve(item.el);
            this.invalidate();
        };
    }

    /** Asks for a frame. Cheap to call many times: at most one frame is scheduled */
    invalidate = () => {
        if (!this.renderer || this.raf) return;
        this.raf = requestAnimationFrame(this.frame);
    };

    mount(canvas: HTMLCanvasElement) {
        try {
            this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "high-performance" });
        } catch {
            this.renderer = null; // no WebGL: the DOM stays visible (see .gl-text)
            return;
        }
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.setClearColor(0x000000, 0);

        this.observer = new ResizeObserver(this.invalidate);
        this.observer.observe(document.documentElement); // layout shifts move items without resizing them
        this.entries.forEach(({ item }) => this.observer!.observe(item.el));

        window.addEventListener("resize", this.onResize);
        window.addEventListener("scroll", this.invalidate, { passive: true });
        this.onResize();
    }

    unmount() {
        cancelAnimationFrame(this.raf);
        this.raf = 0;
        this.observer?.disconnect();
        this.observer = null;
        window.removeEventListener("resize", this.onResize);
        window.removeEventListener("scroll", this.invalidate);
        this.renderer?.dispose();
        this.renderer = null;
    }

    private onResize = () => {
        const renderer = this.renderer!;
        const canvas = renderer.domElement;
        this.width = canvas.clientWidth || window.innerWidth;
        this.height = canvas.clientHeight || window.innerHeight;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(this.width, this.height, false);
        // 1 unit = 1 CSS px, origin at the center of the viewport
        Object.assign(this.camera, { left: -this.width / 2, right: this.width / 2, top: this.height / 2, bottom: -this.height / 2 });
        this.camera.updateProjectionMatrix();
        this.invalidate();
    };

    private frame = (now: number) => {
        this.raf = 0;
        const renderer = this.renderer;
        if (!renderer) return;
        const pixelRatio = renderer.getPixelRatio();
        let animating = false;

        for (const entry of this.entries.values()) {
            const { item, group } = entry;
            const rect = item.el.getBoundingClientRect();
            const bx = item.bleed?.x ?? 0;
            const by = item.bleed?.y ?? 0;
            const width = rect.width + bx * 2;
            const height = rect.height + by * 2;

            group.visible =
                width > 0 && height > 0 &&
                rect.bottom + by > 0 && rect.top - by < this.height &&
                rect.right + bx > 0 && rect.left - bx < this.width;
            group.position.set(rect.left + rect.width / 2 - this.width / 2, this.height / 2 - (rect.top + rect.height / 2), 0);
            group.scale.set(width || 1, height || 1, 1);

            if (width !== entry.width || height !== entry.height || pixelRatio !== entry.pixelRatio) {
                Object.assign(entry, { width, height, pixelRatio });
                if (width > 0 && height > 0) item.resize?.(width, height, pixelRatio);
            }
            // Animations keep advancing off-screen so they end in the right state
            if (item.update?.(now)) animating = true;
        }

        renderer.render(this.scene, this.camera);
        if (animating) this.invalidate();
    };
}

export const prefersReducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
