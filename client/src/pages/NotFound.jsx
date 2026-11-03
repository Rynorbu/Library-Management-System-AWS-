import { Link } from 'react-router-dom';
import { BookX } from 'lucide-react';
import { Empty } from '../components/ui.jsx';

export default function NotFound() {
  return (
    <div className="container page">
      <Empty
        icon={BookX}
        title="This page is checked out"
        text="We couldn't find the page you were looking for. It may have been moved or never existed."
        action={
          <Link to="/books" className="btn btn-primary">
            Back to the catalogue
          </Link>
        }
      />
    </div>
  );
}
