import React, { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { AlertTriangle, Info } from 'lucide-react';
import './Modal.css';

interface ModalOptions {
  title?: string;
  message: string | ReactNode;
  type?: 'alert' | 'confirm';
  confirmText?: string;
  cancelText?: string;
}

interface ModalContextType {
  showAlert: (options: string | ModalOptions) => Promise<void>;
  showConfirm: (options: string | ModalOptions) => Promise<boolean>;
}

const ModalContext = createContext<ModalContextType | undefined>(undefined);

export const useModal = () => {
  const context = useContext(ModalContext);
  if (!context) {
    throw new Error('useModal must be used within a ModalProvider');
  }
  return context;
};

export const ModalProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [options, setOptions] = useState<ModalOptions>({ message: '' });
  const [resolver, setResolver] = useState<{ resolve: (value: boolean) => void } | null>(null);

  const showAlert = useCallback((opts: string | ModalOptions) => {
    return new Promise<void>((resolve) => {
      const parsedOpts = typeof opts === 'string' ? { message: opts } : opts;
      setOptions({ type: 'alert', title: '提示', confirmText: '确定', ...parsedOpts });
      setResolver({ resolve: () => resolve() });
      setIsOpen(true);
    });
  }, []);

  const showConfirm = useCallback((opts: string | ModalOptions) => {
    return new Promise<boolean>((resolve) => {
      const parsedOpts = typeof opts === 'string' ? { message: opts } : opts;
      setOptions({ type: 'confirm', title: '确认', confirmText: '确定', cancelText: '取消', ...parsedOpts });
      setResolver({ resolve });
      setIsOpen(true);
    });
  }, []);

  const handleConfirm = () => {
    setIsOpen(false);
    if (resolver) resolver.resolve(true);
  };

  const handleCancel = () => {
    setIsOpen(false);
    if (resolver) resolver.resolve(false);
  };

  return (
    <ModalContext.Provider value={{ showAlert, showConfirm }}>
      {children}
      {isOpen && (
        <div className="modal-overlay glass-modal-overlay">
          <div className="modal-content glass-modal">
            <div className="modal-header">
              {options.type === 'confirm' ? (
                <AlertTriangle color="#f59e0b" size={24} />
              ) : (
                <Info color="#3b82f6" size={24} />
              )}
              <h4>{options.title}</h4>
            </div>
            <div className="modal-body" style={{ whiteSpace: 'pre-wrap' }}>
              {options.message}
            </div>
            <div className="modal-actions">
              {options.type === 'confirm' && (
                <button className="btn-cancel" onClick={handleCancel}>
                  {options.cancelText}
                </button>
              )}
              <button className={options.type === 'confirm' ? 'btn-danger' : 'btn-primary'} onClick={handleConfirm}>
                {options.confirmText}
              </button>
            </div>
          </div>
        </div>
      )}
    </ModalContext.Provider>
  );
};
