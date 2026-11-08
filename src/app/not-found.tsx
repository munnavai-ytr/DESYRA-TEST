import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { AlertCircle } from 'lucide-react';

export default function NotFound() {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <EmptyState
        icon={<AlertCircle className="w-8 h-8 text-[var(--warning)]" />}
        title="Page Not Found"
        description="The page or project route you requested does not exist."
        action={
          <Link href="/">
            <Button variant="primary" size="sm">
              Return Home
            </Button>
          </Link>
        }
      />
    </div>
  );
}
