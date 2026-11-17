"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ItemSlider, { type Slide } from "./ItemSlider";

type Direction = "next" | "prev";

const SLIDES: Slide[] = [
    {
        title: "Item Title 1",
        image: "/pexels-kandrin-19008584.jpg",
        contentTitle: "Item Content 1",
        description:
            "Lorem ipsum dolor sit amet consectetur adipisicing elit. Esse deserunt doloribus possimus neque corporis, sint labore commodi autem odit quam tempore placeat mollitia in distinctio ullam, ratione fuga, fugiat impedit.",
    },
    {
        title: "Item Title 2",
        image: "/pexels-royce-ukpabia-427074950-17014536.jpg",
        contentTitle: "Item Content 2",
        description:
            "Lorem ipsum dolor sit amet consectetur adipisicing elit. Esse deserunt doloribus possimus neque corporis, sint labore commodi autem odit quam tempore placeat mollitia in distinctio ullam, ratione fuga, fugiat impedit.",
    },
    {
        title: "Item Title 3",
        image: "/pexels-theresaude-30907864.jpg",
        contentTitle: "Item Content 3",
        description:
            "Lorem ipsum dolor sit amet consectetur adipisicing elit. Esse deserunt doloribus possimus neque corporis, sint labore commodi autem odit quam tempore placeat mollitia in distinctio ullam, ratione fuga, fugiat impedit.",
    },
];

// WebGL mask duration + navigation lock; keep >= longest text animation (duration + delay) in itemSlider.scss
const TRANSITION_MS = 1100;

const SliderSection = () => {
    const [active, setActive] = useState(0);
    const [previous, setPrevious] = useState<number | null>(null);
    const [direction, setDirection] = useState<Direction>("next");
    const locked = useRef(false);

    const goTo = useCallback(
        (dir: Direction) => {
            if (locked.current) return;
            locked.current = true;
            setTimeout(() => (locked.current = false), TRANSITION_MS);

            const count = SLIDES.length;
            setDirection(dir);
            setPrevious(active);
            setActive((active + (dir === "next" ? 1 : -1) + count) % count);
        },
        [active],
    );

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "ArrowRight") goTo("next");
            if (e.key === "ArrowLeft") goTo("prev");
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [goTo]);

    return <div className="slider-section">
        <div className="slider-container">
            <div className={`slider-wrapper dir-${direction}`}>
                <ItemSlider
                    slides={SLIDES}
                    active={active}
                    previous={previous}
                    direction={direction}
                    duration={TRANSITION_MS}
                />
                <div className="slider-nav">
                    <button type="button" onClick={() => goTo("prev")} aria-label="Slide précédent">
                        ←
                    </button>
                    <span className="slider-counter">
                        {String(active + 1).padStart(2, "0")} / {String(SLIDES.length).padStart(2, "0")}
                    </span>
                    <button type="button" onClick={() => goTo("next")} aria-label="Slide suivant">
                        →
                    </button>
                </div>
            </div>
        </div>
    </div>;
};

export default SliderSection;
