import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../../contexts/AuthContext';
import { ThemeProvider } from '../../contexts/ThemeContext';
import { StatusBar } from '../StatusBar';
import { ConfirmModal } from '../ConfirmModal';
import { EmptyState } from '../EmptyState';
import { ErrorBoundary } from '../ErrorBoundary';
import { SegmentedControl } from '../SegmentedControl';
import { LabeledField } from '../LabeledField';
import { IconButton } from '../IconButton';

function renderWithAuth(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      <ThemeProvider>
        <AuthProvider>{ui}</AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

describe('StatusBar', () => {
  it('renders without crashing', () => {
    renderWithAuth(<StatusBar />);
  });
});

describe('ConfirmModal', () => {
  it('renders when open and calls onConfirm', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmModal isOpen={true} title="Delete?" description="Are you sure?" confirmLabel="Delete" onConfirm={onConfirm} onCancel={onCancel} />,
    );
    expect(screen.getByText('Delete?')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Delete'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('does not render when closed', () => {
    render(
      <ConfirmModal isOpen={false} title="Delete?" description="Are you sure?" confirmLabel="Delete" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByText('Delete?')).not.toBeInTheDocument();
  });
});

describe('EmptyState', () => {
  it('renders title and description', () => {
    render(<EmptyState title="No items" description="Nothing here yet" />);
    expect(screen.getByText('No items')).toBeInTheDocument();
    expect(screen.getByText('Nothing here yet')).toBeInTheDocument();
  });
});

describe('ErrorBoundary', () => {
  it('catches errors and shows fallback', () => {
    const Throw: React.FC = () => {
      throw new Error('test error');
    };
    render(
      <ErrorBoundary>
        <Throw />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/test error/i)).toBeInTheDocument();
  });

  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>OK</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('OK')).toBeInTheDocument();
  });
});

describe('SegmentedControl', () => {
  it('renders options and calls onChange', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        options={[{ label: 'A', value: 'a' }, { label: 'B', value: 'b' }]}
        value="a"
        onChange={onChange}
      />,
    );
    expect(screen.getByText('A')).toBeInTheDocument();
    fireEvent.click(screen.getByText('B'));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});

describe('LabeledField', () => {
  it('renders label and children', () => {
    render(
      <LabeledField label="Name">
        <input />
      </LabeledField>,
    );
    expect(screen.getByText('Name')).toBeInTheDocument();
  });
});

describe('IconButton', () => {
  it('renders and calls onClick', () => {
    const onClick = vi.fn();
    render(<IconButton label="Delete" onClick={onClick}>X</IconButton>);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalled();
  });
});
