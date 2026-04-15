import { useState, useCallback, useEffect } from 'react'
import { Copy, Check } from 'lucide-react'
import 'liquidglass.css'
import './index.css'

interface SliderConfig {
  name: string
  cssVar: string
  min: number
  max: number
  unit?: string
}

const SLIDERS: SliderConfig[] = [
  { name: 'refraction', cssVar: '--liquidglass-refraction', min: 0, max: 100 },
  { name: 'thickness', cssVar: '--liquidglass-thickness', min: 0, max: 100 },
  { name: 'softness', cssVar: '--liquidglass-softness', min: 0, max: 100 },
  { name: 'gloss', cssVar: '--liquidglass-gloss', min: 0, max: 100 },
  { name: 'saturation', cssVar: '--liquidglass-saturation', min: 0, max: 100 },
  { name: 'dispersion', cssVar: '--liquidglass-dispersion', min: 0, max: 100 },
]

function App() {
  const [values, setValues] = useState<Record<string, number>>({
    refraction: 83,
    thickness: 0,
    softness: 84,
    gloss: 28,
    saturation: 42,
    dispersion: 35,
  })

  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  const handleSliderChange = useCallback((name: string, clientX: number, sliderRect: DOMRect) => {
    const slider = SLIDERS.find(s => s.name === name)
    if (!slider) return

    const percent = Math.max(0, Math.min(1, (clientX - sliderRect.left) / sliderRect.width))
    const value = Math.round(slider.min + percent * (slider.max - slider.min))
    setValues(prev => ({ ...prev, [name]: value }))
  }, [])

  const handleCopy = useCallback(async (text: string, index: number) => {
    await navigator.clipboard.writeText(text)
    setCopiedIndex(index)
    setTimeout(() => setCopiedIndex(null), 2000)
  }, [])

  const generateCSS = () => {
    const lines = SLIDERS.map(s => {
      const value = values[s.name]
      const displayValue = s.unit ? `${value}${s.unit}` : value
      const varName = s.cssVar.padEnd(32)
      return `  ${varName}${displayValue};`
    })
    return `div {\n${lines.join('\n')}\n}`
  }

  const cssOutput = generateCSS()

  // Syntax highlighted CSS for display
  const renderHighlightedCSS = () => {
    return (
      <>
        <span className="text-[#d73a49]">div</span>
        <span className="text-black"> {'{'}</span>
        {'\n'}
        {SLIDERS.map((s, i) => {
          const value = values[s.name]
          const isLast = i === SLIDERS.length - 1
          const displayValue = s.unit ? `${value}${s.unit}` : String(value)

          return (
            <span key={s.name}>
              {'  '}
              <span className="text-[#005cc5]">{s.cssVar.padEnd(28)}</span>
              {s.unit ? (
                <>
                  <span className="text-[#005cc5]">{value}</span>
                  <span className="text-[#d73a49]">{s.unit}</span>
                </>
              ) : (
                <span className="text-[#005cc5]">{value}</span>
              )}
              <span className="text-black">;</span>
              {!isLast && '\n'}
              {isLast && '\n'}
            </span>
          )
        })}
        <span className="text-black">{'}'}</span>
      </>
    )
  }

  // Generate style object for preview
  const previewStyle: Record<string, string> = {}
  SLIDERS.forEach(s => {
    const value = values[s.name]
    previewStyle[s.cssVar] = String(value)
  })

  return (
    <div className="min-h-screen bg-white font-['Geist_Mono'] flex flex-col lg:flex-row">
      {/* Left Column */}
      <div className="
        flex flex-col
        pt-10 md:pt-[66px]
        px-6 md:pl-[6%] lg:pl-[117px] md:pr-8
        w-full md:w-1/2 lg:w-[38.2%]
        lg:min-w-[480px]
      ">
        {/* Title */}
        <h1 className="
          italic text-black font-medium leading-none
          text-3xl md:text-4xl lg:text-5xl
          md:pl-[9px]
        ">
          liquidglass.css
        </h1>

        {/* Step 1 */}
        <div className="flex items-center mt-10 md:mt-[57px]">
          <span className="w-8 md:w-[49px] flex-shrink-0 font-['Inter_Tight'] text-[#b0b0b0] text-sm">
            ①
          </span>
          <div className="
            bg-[#eee] rounded-xl h-12 flex-1 lg:w-[586px] lg:flex-none
            flex items-center pl-4 md:pl-[23px] pr-10 md:pr-[32px]
            text-xs md:text-[13px] relative
          ">
            <span className="text-black">npm i liquidglass.css</span>
            <button
              onClick={() => handleCopy('npm i liquidglass.css', 0)}
              className="absolute right-3 md:right-[32px] hover:opacity-70 transition-opacity"
            >
              {copiedIndex === 0 ? (
                <Check className="text-green-500" size={14} strokeWidth={1.5} />
              ) : (
                <Copy className="text-[#b0b0b0]" size={14} strokeWidth={1.5} />
              )}
            </button>
          </div>
        </div>

        {/* Step 2 */}
        <div className="flex items-center mt-3 md:mt-[17px]">
          <span className="w-8 md:w-[49px] flex-shrink-0 font-['Inter_Tight'] text-[#8f8f8f] text-sm">
            ②
          </span>
          <div className="
            bg-[#eee] rounded-xl h-12 flex-1 lg:w-[586px] lg:flex-none
            flex items-center pl-4 md:pl-[23px] pr-10 md:pr-[32px]
            text-xs md:text-[13px] relative
          ">
            <span>
              <span className="text-[#d73a49]">import</span>
              <span className="text-black"> </span>
              <span className="text-[#032f62]">"liquidglass.css"</span>
            </span>
            <button
              onClick={() => handleCopy('import "liquidglass.css"', 1)}
              className="absolute right-3 md:right-[32px] hover:opacity-70 transition-opacity"
            >
              {copiedIndex === 1 ? (
                <Check className="text-green-500" size={14} strokeWidth={1.5} />
              ) : (
                <Copy className="text-[#8f8f8f]" size={14} strokeWidth={1.5} />
              )}
            </button>
          </div>
        </div>

        {/* Step 3 - Sliders */}
        <div className="flex mt-6 md:mt-[27px]">
          <span className="
            w-8 md:w-[49px] flex-shrink-0
            font-['Inter_Tight'] text-[#a1a1a1] text-sm
            pt-[3px] md:pl-[4px]
          ">
            ③
          </span>
          <div className="flex flex-col gap-4 md:gap-[19px] flex-1 lg:w-[586px] lg:flex-none pl-px">
            {SLIDERS.map((slider, i) => {
              const value = values[slider.name]
              const percent = (value - slider.min) / (slider.max - slider.min)
              const displayValue = slider.unit ? `${value}${slider.unit}` : String(value)

              return (
                <div
                  key={slider.name}
                  className="flex items-center cursor-pointer select-none"
                  onMouseDown={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    handleSliderChange(slider.name, e.clientX, rect)

                    const handleMove = (moveEvent: MouseEvent) => {
                      handleSliderChange(slider.name, moveEvent.clientX, rect)
                    }
                    const handleUp = () => {
                      document.removeEventListener('mousemove', handleMove)
                      document.removeEventListener('mouseup', handleUp)
                    }
                    document.addEventListener('mousemove', handleMove)
                    document.addEventListener('mouseup', handleUp)
                  }}
                  onTouchStart={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect()
                    const touch = e.touches[0]
                    handleSliderChange(slider.name, touch.clientX, rect)

                    const handleMove = (moveEvent: TouchEvent) => {
                      const t = moveEvent.touches[0]
                      handleSliderChange(slider.name, t.clientX, rect)
                    }
                    const handleEnd = () => {
                      document.removeEventListener('touchmove', handleMove)
                      document.removeEventListener('touchend', handleEnd)
                    }
                    document.addEventListener('touchmove', handleMove)
                    document.addEventListener('touchend', handleEnd)
                  }}
                >
                  {/* Left line */}
                  <div
                    className="h-1.5 bg-[#d9d9d9] lg:flex-none"
                    style={{ width: `calc(${percent * 100}% - 15px)` }}
                  />
                  {/* Knob */}
                  <div className="
                    w-[30px] h-[30px] bg-black rounded-full
                    text-white text-[13px]
                    flex items-center justify-center flex-shrink-0
                  ">
                    {displayValue}
                  </div>
                  {/* Right line */}
                  <div
                    className="h-1.5 bg-[#d9d9d9] lg:flex-none"
                    style={{ width: `calc(${(1 - percent) * 100}% - 15px)` }}
                  />
                </div>
              )
            })}
          </div>
        </div>

        {/* Step 4 */}
        <div className="flex mt-6 md:mt-[31px] mb-8 lg:mb-0">
          <span className="
            w-8 md:w-[49px] flex-shrink-0
            font-['Inter_Tight'] text-[#858585] text-sm
            pt-4 md:pt-[16px]
          ">
            ④
          </span>
          <div className="
            bg-[#eee] rounded-2xl flex-1 lg:w-[586px] lg:flex-none
            min-h-[200px] lg:h-[264px]
            pt-4 md:pt-[23px] pr-8 md:pr-10 pb-3 pl-4 md:pl-[23px]
            text-xs md:text-[13px] leading-[1.35] relative
          ">
            <pre className="whitespace-pre overflow-x-auto">{renderHighlightedCSS()}</pre>
            <button
              onClick={() => handleCopy(cssOutput, 2)}
              className="absolute right-3 md:right-[32px] top-4 md:top-[23px] hover:opacity-70 transition-opacity"
            >
              {copiedIndex === 2 ? (
                <Check className="text-green-500" size={14} strokeWidth={1.5} />
              ) : (
                <Copy className="text-[#858585]" size={14} strokeWidth={1.5} />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Right Column: Preview */}
      <div className="
        flex-1
        p-6 md:pt-[60px] lg:pt-[60px]
        flex items-center lg:items-start justify-center
      ">
        <div
          className="
            relative overflow-hidden
            rounded-[40px] md:rounded-[60px] lg:rounded-[76px]
            w-full max-w-[400px] md:max-w-none lg:max-w-[936px]
            aspect-[936/873]
          "
        >
          {/* Video Background */}
          <video
            autoPlay
            loop
            muted
            playsInline
            className="absolute inset-0 w-full h-full object-cover"
          >
            <source src="/cosmos-flowers.webm" type="video/webm" />
          </video>

          {/* Liquid Glass Circle */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div
              className="w-[60%] aspect-square rounded-full"
              style={{
                '--liquidglass-refraction': values.refraction,
                '--liquidglass-thickness': values.thickness,
                '--liquidglass-softness': values.softness,
                '--liquidglass-gloss': values.gloss,
                '--liquidglass-saturation': values.saturation,
                '--liquidglass-dispersion': values.dispersion,
              } as React.CSSProperties}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default App
