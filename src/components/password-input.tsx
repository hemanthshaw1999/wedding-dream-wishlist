"use client";

import { useState, type ComponentProps } from "react";

export function PasswordInput(props: Omit<ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);
  return <div className="password-input">
    <input {...props} type={visible ? "text" : "password"} />
    <button type="button" className="text-button" disabled={props.disabled} aria-controls={props.id}
      onClick={() => setVisible(!visible)}>{visible ? "Hide password" : "Show password"}</button>
  </div>;
}
