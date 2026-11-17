import WebGLSlider from "./WebGLSlider";

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

const ItemSlider = ({ slides, active, previous, direction, duration }: ItemSliderProps) => {
    // is-active: slide entering / shown, is-leaving: slide animating out, otherwise hidden
    const state = (i: number) =>
        i === active ? "is-active" : i === previous ? "is-leaving" : "";

    return <div className="slider-item">
                <div className="slider-item-header">
                    {slides.map((slide, i) => (
                        <div key={i} className={`title-wrapper title-${i + 1} ${state(i)}`} aria-hidden={i !== active}>
                            <h2>{slide.title}</h2>
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
                                <h4>{slide.contentTitle}</h4>
                            </div>
                        ))}
                    </div>
                    <div className="content-descs">
                        {slides.map((slide, i) => (
                            <div key={i} className={`content-desc content-desc-${i + 1} ${state(i)}`} aria-hidden={i !== active}>
                                <p>{slide.description}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>;
};

export default ItemSlider;
