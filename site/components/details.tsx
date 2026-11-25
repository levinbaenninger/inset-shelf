import { Heading, Section } from "./section";

// Crops of the details view at their true size, from the panel's top left.
const CARDS = [
  {
    title: "Add next steps",
    text: "A checklist under the item, with its progress on the source line.",
    src: "/img/details-steps.webp",
    alt: "The details view with two next steps and a due date of tomorrow",
  },
  {
    title: "Put a due date on a note",
    text: "Today, tomorrow, this weekend or a date you pick. Overdue items turn red.",
    src: "/img/details-due.webp",
    alt: "The due menu with Today, Tomorrow, This weekend, Next week and Pick a date",
  },
  {
    title: "Copy notes as Markdown",
    text: "Copy with Details adds the description, steps, due date and linked windows.",
    src: "/img/details-copy.webp",
    alt: "An item's menu with Copy, Copy with Details and Copy with Link",
  },
];

export function Details() {
  return (
    <Section id="details" tone="surface" tabletScreens={2} phoneScreens={2} aria-labelledby="details-h">
      <div className="wrap">
        <Heading id="details-h" className="max-w-[22ch]">
          Next steps and due dates, when needed.{" "}
          <span className="text-muted-foreground">None of it is asked for when you capture.</span>
        </Heading>
        <div className="mt-8 grid gap-12 sm:mt-12 lg:grid-cols-3 lg:gap-6">
          {CARDS.map((card) => (
            <article key={card.title}>
              <h3 className="text-xl font-medium">{card.title}</h3>
              <p className="mt-2 max-w-[46ch] text-foreground/85">{card.text}</p>
              <div className="relative mt-6 h-[280px] overflow-hidden rounded-[20px] bg-sky sm:mt-8 sm:h-[440px] lg:h-[300px] xl:h-[384px]">
                <img
                  src={card.src}
                  alt={card.alt}
                  width={820}
                  height={800}
                  loading="lazy"
                  className="absolute top-0 left-0 h-[400px] w-[410px] max-w-none object-cover object-left-top"
                />
              </div>
            </article>
          ))}
        </div>
      </div>
    </Section>
  );
}
