import WebGLSlider from "./WebGLSlider";
import GLText, { type GLTextState } from "./gl/GLText";

export type Slide = {
    title: string;
    image: string;
    contentTitle: string;
    description: string;
};

type ItemSliderProps = {
    slides: Slide[];
    active: number;
    previous: number | null;
    direction: "next" | "prev";
    duration: number; // ms, WebGL mask transition
};

// Text animation length; entering delays are staggered per block (title, content title, description)
const TEXT_MS = 900;

const ItemSlider = ({ slides, active, previous, direction, duration }: ItemSliderProps) => {
    // is-active: slide entering / shown, is-leaving: slide animating out, otherwise hidden
    // (the classes drive the CSS fallback when WebGL is not available)
    const state = (i: number) =>
        i === active ? "is-active" : i === previous ? "is-leaving" : "";
    const glState = (i: number): GLTextState =>
        i === active ? "in" : i === previous ? "out" : "hidden";

    return <div className="slider-item">
                <div className="slider-item-header">
                    {slides.map((slide, i) => (
                        <div key={i} className={`title-wrapper title-${i + 1} ${state(i)}`} aria-hidden={i !== active}>
                            <GLText as="h2" state={glState(i)} direction={direction} duration={TEXT_MS}>
                                {slide.title}
                            </GLText>
                        </div>
                    ))}
                </div>
                <div className="slider-item-image">
                    <WebGLSlider
                        images={slides.map((slide) => slide.image)}
                        active={active}
                        previous={previous}
                        direction={direction}
                        duration={duration}
                        label={slides[active].title}
                    />
                </div>
                <div className="slider-item-content">
                    <div className="content-titles">
                        {slides.map((slide, i) => (
                            <div key={i} className={`content-title content-title-${i + 1} ${state(i)}`} aria-hidden={i !== active}>
                                <GLText as="h4" state={glState(i)} direction={direction} delay={100} duration={TEXT_MS}>
                                    {slide.contentTitle}
                                </GLText>
                            </div>
                        ))}
                    </div>
                    <div className="content-descs">
                        {slides.map((slide, i) => (
                            <div key={i} className={`content-desc content-desc-${i + 1} ${state(i)}`} aria-hidden={i !== active}>
                                <GLText as="p" variant="fade" state={glState(i)} direction={direction} delay={200} duration={TEXT_MS}>
                                    {slide.description}
                                </GLText>
                            </div>
                        ))}
                    </div>
                </div>
            </div>;
};

export default ItemSlider;
