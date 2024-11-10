import { BotOff } from "lucide-react";

export default function NotFound() {
  return (
    <div className="h-screen w-full flex flex-col items-center justify-center gap-4">
      <BotOff className="w-16 h-16 text-gray-400" strokeWidth={1.5} />
      <h1 className="text-xl font-medium text-gray-600">
        Oops! We&apos;re probably still building this page
      </h1>
    </div>
  );
}
