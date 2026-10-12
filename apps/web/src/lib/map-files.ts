/** Reads a JSON file the person picked; null when it is not JSON. */
export async function readJsonFile<T>(file: File): Promise<T | null> {
  try {
    return JSON.parse(await file.text()) as T;
  } catch {
    return null;
  }
}

/** Map files over 1 MB go as this media type (the server takes up to 32 MB of it). */
export const MAP_FILE_TYPE = 'application/vnd.darkbeacon.map+json';
