import { Copy } from 'lucide-react'
import './index.css'

/**
 * Tailwindトランスパイル版
 *
 * 変換ルール:
 * - 完全一致 → Tailwindクラス使用
 * - 不一致 → arbitrary value [Xpx] で誤差なし維持
 */

function App() {
  const sliderRows = [
    { y: 325, value: '50' },
    { y: 374, value: '50' },
    { y: 423, value: '50' },
    { y: 472, value: '50' },
    { y: 521, value: '50' },
    { y: 569, value: '50' },
    { y: 618, value: '50px' },
  ];

  return (
    <div className="relative w-[1919px] h-[997px] bg-white font-['Geist_Mono'] overflow-hidden">

      {/* Title - text-5xl(48px)✓, font-medium(500)✓, leading-none(1.0)✓ */}
      <div className="absolute italic text-black text-5xl font-medium leading-none left-[126px] top-[66px]">
        liquidglass.css
      </div>

      {/* Step 1 */}
      <span className="absolute font-['Inter_Tight'] text-[#b0b0b0] text-sm left-[117px] top-[184px]">
        ①
      </span>
      <div className="absolute bg-[#eee] flex items-center rounded-xl h-12 pl-[23px] text-[13px] left-[166px] top-[171px] w-[586px]">
        <span className="text-black">npm i liquidglass.css</span>
      </div>
      <Copy
        className="absolute text-[#b0b0b0] left-[720px] top-[187px]"
        size={14}
        strokeWidth={1.5}
      />

      {/* Step 2 */}
      <span className="absolute font-['Inter_Tight'] text-[#8f8f8f] text-sm left-[117px] top-[250px]">
        ②
      </span>
      <div className="absolute bg-[#eee] flex items-center rounded-xl h-12 pl-[23px] text-[13px] left-[166px] top-[236px] w-[586px]">
        <span className="text-black">import "liquidglass.css"</span>
      </div>
      <Copy
        className="absolute text-[#8f8f8f] left-[720px] top-[252px]"
        size={14}
        strokeWidth={1.5}
      />

      {/* Step 3 */}
      <span className="absolute font-['Inter_Tight'] text-[#a1a1a1] text-sm left-[121px] top-[314px]">
        ③
      </span>

      {/* Slider rows */}
      {sliderRows.map((row, i) => (
        <div key={i}>
          {/* Left gray line: h-[6px] = h-1.5 ✓ */}
          <div
            className="absolute h-1.5 bg-[#d9d9d9] left-[167px] w-[275px]"
            style={{ top: row.y - 3 }}
          />
          {/* Knob: w-[30px] h-[30px] rounded-full */}
          <div
            className="absolute bg-black rounded-full flex items-center justify-center text-white w-[30px] h-[30px] text-[13px] left-[445px]"
            style={{ top: row.y - 14 }}
          >
            {row.value}
          </div>
          {/* Right gray line */}
          <div
            className="absolute h-1.5 bg-[#d9d9d9] left-[477px] w-[275px]"
            style={{ top: row.y - 3 }}
          />
        </div>
      ))}

      {/* Step 4 */}
      <span className="absolute font-['Inter_Tight'] text-[#858585] text-sm left-[117px] top-[682px]">
        ④
      </span>
      <div className="absolute bg-[#eee] text-black rounded-2xl text-[13px] leading-[1.35] left-[166px] top-[666px] w-[586px] h-[264px] pt-[23px] pr-10 pb-3 pl-[23px]">
        <pre className="whitespace-pre">{`div {
  --liquidglass-refraction:    50;
  --liquidglass-thickness:     50;
  --liquidglass-softness:      50;
  --liquidglass-gloss:         50;
  --liquidglass-saturation:    50;
  --liquidglass-dispersion:    50;

  border-radius:               50px;
}`}</pre>
      </div>
      <Copy
        className="absolute text-[#858585] left-[720px] top-[684px]"
        size={14}
        strokeWidth={1.5}
      />

      {/* Black preview box */}
      <div className="absolute bg-black rounded-[76px] left-[858px] top-[60px] w-[936px] h-[873px]" />
    </div>
  )
}

export default App
