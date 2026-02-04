export default function Logo({
  className = "",
  alt = "TopTry",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <img
      src="/branding/logo.png"
      alt={alt}
      className={className}
      draggable={false}
    />
  );
}

