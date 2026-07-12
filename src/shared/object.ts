type RequiredDefinedKeys<T extends object> = {
  [Key in keyof T]-?: undefined extends T[Key] ? never : Key;
}[keyof T];

type OptionalDefinedKeys<T extends object> = Exclude<keyof T, RequiredDefinedKeys<T>>;

export type UndefinedOmitted<T extends object> = {
  [Key in RequiredDefinedKeys<T>]: T[Key];
} & {
  [Key in OptionalDefinedKeys<T>]?: Exclude<T[Key], undefined>;
};

export function omitUndefined<T extends object>(value: T): UndefinedOmitted<T> {
  const entries = Object.entries(value).filter(([, entryValue]) => entryValue !== undefined);
  return Object.fromEntries(entries) as UndefinedOmitted<T>;
}
