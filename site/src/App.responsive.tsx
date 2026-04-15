import { Copy } from 'lucide-react'
import './index.css'

/**
 * Responsive Tailwind Version
 *
 * Layout Intent (derived via SAT solver analysis):
 * - Golden ratio split: content(38.2%) : preview(61.8%)
 * - Left margin: ~8.6% of viewport
 * - Vertical rhythm: 48px (h-12) base unit
 * - Slider spacing: ~49px intervals
 *
 * Breakpoints:
 * - sm (<768px): Stack vertically, full width
 * - md (768-1024px): Side by side, 50/50 split
 * - lg (1024px+): Golden ratio layout
 */

function App() {
  const sliderRows = [
    { label: 'refraction', value: '50' },
    { label: 'thickness', value: '50' },
    { label: 'softness', value: '50' },
    { label: 'gloss', value: '50' },
    { label: 'saturation', value: '50' },
    { label: 'dispersion', value: '50' },
    { label: 'border-radius', value: '50px' },
  ]

  return (
    <div className="min-h-screen bg-white font-['Geist_Mono'] flex flex-col lg:flex-row">
      {/* Left Content Area */}
      {/* sm: full width, md: 50%, lg: golden ratio 38.2% */}
      <div className="w-full md:w-1/2 lg:w-[38.2%] lg:min-w-[500px] px-6 md:pl-[8.6%] md:pr-8 py-10 lg:py-16 flex flex-col">
        {/* Title */}
        <h1 className="italic text-black text-3xl md:text-4xl lg:text-5xl font-medium leading-none mb-12 lg:mb-24">
          liquidglass.css
        </h1>

        {/* Steps Container */}
        <div className="flex flex-col gap-4">
          {/* Step 1 */}
          <div className="flex items-center gap-3 md:gap-4">
            <span className="font-['Inter_Tight'] text-[#b0b0b0] text-sm w-5 md:w-6 flex-shrink-0">①</span>
            <div className="bg-[#eee] flex items-center justify-between rounded-xl h-12 px-4 md:px-6 text-xs md:text-[13px] flex-1 max-w-[586px]">
              <span className="text-black">npm i liquidglass.css</span>
              <Copy className="text-[#b0b0b0] flex-shrink-0 ml-2" size={14} strokeWidth={1.5} />
            </div>
          </div>

          {/* Step 2 */}
          <div className="flex items-center gap-3 md:gap-4">
            <span className="font-['Inter_Tight'] text-[#8f8f8f] text-sm w-5 md:w-6 flex-shrink-0">②</span>
            <div className="bg-[#eee] flex items-center justify-between rounded-xl h-12 px-4 md:px-6 text-xs md:text-[13px] flex-1 max-w-[586px]">
              <span className="text-black">import "liquidglass.css"</span>
              <Copy className="text-[#8f8f8f] flex-shrink-0 ml-2" size={14} strokeWidth={1.5} />
            </div>
          </div>

          {/* Step 3 - Sliders */}
          <div className="flex items-start gap-3 md:gap-4 mt-6 lg:mt-8">
            <span className="font-['Inter_Tight'] text-[#a1a1a1] text-sm w-5 md:w-6 pt-1 flex-shrink-0">③</span>
            <div className="flex flex-col gap-4 md:gap-[18px] flex-1 max-w-[586px]">
              {sliderRows.map((row, i) => (
                <div key={i} className="flex items-center">
                  {/* Left line */}
                  <div className="h-1.5 bg-[#d9d9d9] flex-1" />
                  {/* Knob */}
                  <div className="bg-black rounded-full flex items-center justify-center text-white w-[30px] h-[30px] text-[13px] mx-0.5 flex-shrink-0">
                    {row.value}
                  </div>
                  {/* Right line */}
                  <div className="h-1.5 bg-[#d9d9d9] flex-1" />
                </div>
              ))}
            </div>
          </div>

          {/* Step 4 - Code Block */}
          <div className="flex items-start gap-3 md:gap-4 mt-4 lg:mt-6">
            <span className="font-['Inter_Tight'] text-[#858585] text-sm w-5 md:w-6 pt-5 md:pt-6 flex-shrink-0">④</span>
            <div className="bg-[#eee] rounded-2xl text-xs md:text-[13px] leading-[1.35] flex-1 max-w-[586px] pt-5 md:pt-6 pr-8 md:pr-10 pb-3 pl-5 md:pl-6 relative">
              <pre className="whitespace-pre text-black overflow-x-auto">{`div {
  --liquidglass-refraction:    50;
  --liquidglass-thickness:     50;
  --liquidglass-softness:      50;
  --liquidglass-gloss:         50;
  --liquidglass-saturation:    50;
  --liquidglass-dispersion:    50;

  border-radius:               50px;
}`}</pre>
              <Copy
                className="absolute text-[#858585] right-4 md:right-6 top-5 md:top-6"
                size={14}
                strokeWidth={1.5}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Right Preview Area */}
      {/* sm: full width below, md: 50%, lg: golden ratio 61.8% */}
      <div className="flex-1 p-6 md:p-10 lg:p-[60px] flex items-center lg:items-start justify-center">
        {/* Black preview box - maintains aspect ratio */}
        <div className="bg-black rounded-[40px] md:rounded-[60px] lg:rounded-[76px] w-full max-w-[500px] md:max-w-none lg:max-w-[936px] aspect-[936/873]" />
      </div>
    </div>
  )
}

export default App
