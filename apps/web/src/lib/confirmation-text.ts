const normalized = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
/** A dialog whose body repeats its title tells the reader nothing new (QA-048). */
export function isRepeatedConfirmationText(title: string, description: string) {
  return normalized(title) === normalized(description);
}
