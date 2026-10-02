/** Shared social artwork; public/og.svg is the editable source for public/og.png. */
export function OgImage() {
  return (
    <img
      src={`${import.meta.env.BASE_URL}og.png`}
      width={1200}
      height={630}
      alt="Quorate — a council of AI reviewers for your code"
    />
  );
}
