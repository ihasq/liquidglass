import { Copy } from 'lucide-react'
import './index.css'

/**
 * Final Responsive Version
 *
 * SAT Solver導出値 → レスポンシブ変換:
 *
 * 絶対値 (1919px viewport):
 *   pl-[117px] = 6.1%
 *   w-[586px] = 30.5% (content)
 *   w-[936px] = 48.8% (preview)
 *   gap 106px = 5.5%
 *
 * Golden ratio: content:preview = 1:1.597 ≈ φ
 *
 * Breakpoints:
 *   sm (<768px): Stack, full width
 *   md (768-1280px): Side by side, equal
 *   lg (1280px+): Golden ratio
 */

function App() {
  const sliders = [
    { value: '50' },
    { value: '50' },
    { value: '50' },
    { value: '50' },
    { value: '50' },
    { value: '50' },
    { value: '50px' },
  ]

  return (
    <div className="min-h-screen bg-white font-['Geist_Mono'] flex flex-col lg:flex-row">
      {/* 左カラム: sm=full, md=50%, lg=黄金比38.2%
          SAT Solver導出: pt-[66px] pl-[117px] at 1919px viewport */}
      <div className="
        flex flex-col
        pt-10 md:pt-[66px]
        px-6 md:pl-[6%] lg:pl-[117px] md:pr-8
        w-full md:w-1/2 lg:w-[38.2%]
        lg:min-w-[480px]
      ">
        {/* タイトル */}
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
            <Copy
              className="absolute text-[#b0b0b0] right-3 md:right-[32px]"
              size={14}
              strokeWidth={1.5}
            />
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
            <span className="text-black">import "liquidglass.css"</span>
            <Copy
              className="absolute text-[#8f8f8f] right-3 md:right-[32px]"
              size={14}
              strokeWidth={1.5}
            />
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
            {sliders.map((s, i) => (
              <div key={i} className="flex items-center">
                <div className="h-1.5 bg-[#d9d9d9] flex-1 lg:w-[275px] lg:flex-none" />
                <div className="w-0.5 md:w-[3px]" />
                <div className="
                  w-[30px] h-[30px] bg-black rounded-full
                  text-white text-[13px]
                  flex items-center justify-center flex-shrink-0
                ">
                  {s.value}
                </div>
                <div className="w-0.5 md:w-[2px]" />
                <div className="h-1.5 bg-[#d9d9d9] flex-1 lg:w-[275px] lg:flex-none" />
              </div>
            ))}
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
              className="absolute text-[#858585] right-3 md:right-[32px] top-4 md:top-[23px]"
              size={14}
              strokeWidth={1.5}
            />
          </div>
        </div>
      </div>

      {/* 右カラム: プレビュー */}
      {/* sm: below content, md: 50%, lg: golden ratio 61.8%
          SAT Solver: pt-[60px], justify-center places preview at x=858 */}
      <div className="
        flex-1
        p-6 md:pt-[60px] lg:pt-[60px]
        flex items-center lg:items-start justify-center
      ">
        <div className="
          bg-black
          rounded-[40px] md:rounded-[60px] lg:rounded-[76px]
          w-full max-w-[400px] md:max-w-none lg:max-w-[936px]
          aspect-[936/873]
        " />
      </div>
    </div>
  )
}

export default App
