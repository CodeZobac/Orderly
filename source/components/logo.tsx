import Image from "next/image";
import logo from "../public/brand/orderly-supplied.png";

export function Logo() {
  return (
    <span className="logo-model" aria-hidden="true">
      <Image
        src={logo}
        alt=""
        sizes="64px"
        className="logo-image logo-image--light logo-image--supplied-png"
      />
    </span>
  );
}
