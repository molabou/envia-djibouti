import React from 'react';
import {createRoot} from 'react-dom/client';
import EnviaApp from './components/envia-app';
import './globals.css';
createRoot(document.getElementById('root')!).render(<React.StrictMode><EnviaApp/></React.StrictMode>);
