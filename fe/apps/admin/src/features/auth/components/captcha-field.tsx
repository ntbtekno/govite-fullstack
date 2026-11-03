import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@app/ui/components/button"
import { Input } from "@app/ui/components/input"
import { Label } from "@app/ui/components/label"
import { getCaptcha } from "@/lib/auth-api"

export interface CaptchaFieldHandle {
  /** Fetches a new challenge and clears the answer. The old image is spent. */
  reload: () => Promise<void>
  /** The current captcha id, read on submit. */
  id: () => string
}

interface CaptchaFieldProps {
  error?: boolean
}

/**
 * Loads and shows a server-rendered captcha. The image is the only thing the
 * server sends; the code is entered by the user and verified server-side. The
 * parent reloads it after every failed login, because a used captcha is spent.
 */
export const CaptchaField = forwardRef<CaptchaFieldHandle, CaptchaFieldProps>(
  function CaptchaField({ error }, ref) {
    const [image, setImage] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)
    const [failed, setFailed] = useState(false)
    const idRef = useRef("")
    const inputRef = useRef<HTMLInputElement>(null)

    const reload = useCallback(async () => {
      setLoading(true)
      setFailed(false)
      if (inputRef.current) inputRef.current.value = ""
      try {
        const captcha = await getCaptcha()
        setImage(captcha.image)
        idRef.current = captcha.captchaId
      } catch {
        setImage(null)
        setFailed(true)
        idRef.current = ""
      } finally {
        setLoading(false)
      }
    }, [])

    useEffect(() => {
      void reload()
    }, [reload])

    useImperativeHandle(ref, () => ({ reload, id: () => idRef.current }), [
      reload,
    ])

    return (
      <div className="space-y-1.5">
        <Label htmlFor="captcha">Captcha</Label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void reload()}
            title="Muat ulang captcha"
            aria-label="Muat ulang captcha"
            className="flex h-14 w-40 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted"
          >
            {image ? (
              <img
                src={image}
                alt="Gambar captcha"
                className="h-full w-full object-contain"
              />
            ) : (
              <span className="text-xs text-muted-foreground">
                {loading ? "Memuat…" : "Gagal memuat"}
              </span>
            )}
          </button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={() => void reload()}
            disabled={loading}
            aria-label="Muat ulang captcha"
          >
            <RefreshCw className={loading ? "animate-spin" : undefined} />
          </Button>
          <Input
            ref={inputRef}
            id="captcha"
            name="captcha"
            autoComplete="off"
            autoCapitalize="characters"
            maxLength={16}
            placeholder="Ketik kode"
            required
            aria-invalid={error || failed}
          />
        </div>
        {failed && (
          <p className="text-xs text-destructive">
            Gagal memuat captcha. Coba muat ulang.
          </p>
        )}
      </div>
    )
  }
)
