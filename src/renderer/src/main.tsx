import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/globals.css'

const container = document.getElementById('root')
if (container) {
  ReactDOM.createRoot(container).render(<App />)
}
