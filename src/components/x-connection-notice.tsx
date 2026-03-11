function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function XConnectionNotice({
  connected,
  connectError
}: {
  connected?: string;
  connectError?: string;
}) {

  if (connected === "1") {
    return <p className="list-meta">X account connected successfully.</p>;
  }

  if (connectError) {
    return <p className="list-meta">X connection error: {safeDecode(connectError)}</p>;
  }

  return null;
}
