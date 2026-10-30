import { tr, onLocaleChange } from '../i18n/locale'
/**
 * "保护" (Acrobat: 保护 → 使用密码加密): open password, permissions
 * password + permissions, or removing the protection. Applied on save.
 */
import { useState } from 'react'
import { useAppStore } from '../state/stores'
import { useEditStore } from '../state/editStore'
import { newOpId, type SecurityOp } from '../pdf/edit/ops'
import { latestSecurityOp } from '../utils/output'
import { ALL_PERMISSIONS, type Permissions } from '../pdf/security/standardSecurity'
import { unlockWithOwnerPassword } from '../utils/secureOpen'
import { notify } from '../utils/save'
import { IconClose, IconLock, IconLockOpen } from './icons'

function createPermLabels(): [keyof Permissions, string][] {
  return [
    ['print', tr('打印')],
    ['printHigh', tr('高质量打印')],
    ['copy', tr('复制文字和图片')],
    ['modify', tr('编辑内容')],
    ['annotate', tr('添加批注')],
    ['fillForms', tr('填写表单与签名')],
    ['assemble', tr('插入、旋转、删除页面')],
  ]
}

let PERM_LABELS: [keyof Permissions, string][] = createPermLabels()

export function ProtectDialog({ onClose }: { onClose: () => void }) {
  const encryption = useAppStore((s) => s.encryption)
  const pending = latestSecurityOp()
  const locked = !!encryption && !encryption.owner && encryption.info.restricted
  const initial = pending?.protect ?? null
  const currentlyProtected = pending ? !!pending.protect : !!encryption

  const [useOpen, setUseOpen] = useState(initial ? !!initial.userPassword : !!encryption?.info.needsPassword)
  const knownOpen = initial?.userPassword ?? encryption?.userPassword ?? ''
  const [openPw, setOpenPw] = useState(knownOpen)
  const [openPw2, setOpenPw2] = useState(knownOpen)
  const [useOwner, setUseOwner] = useState(initial ? !!initial.ownerPassword : !!encryption?.info.restricted)
  const [ownerPw, setOwnerPw] = useState(initial?.ownerPassword ?? '')
  // a new restriction starts from "print only" (Acrobat's default)
  const PRINT_ONLY: Permissions = {
    print: true,
    printHigh: true,
    modify: false,
    copy: false,
    annotate: false,
    fillForms: false,
    assemble: false,
  }
  const [perms, setPerms] = useState<Permissions>(
    initial?.permissions ?? (encryption?.info.restricted ? encryption.info.permissions : PRINT_ONLY),
  )
  const [unlockPw, setUnlockPw] = useState('')
  const [unlockErr, setUnlockErr] = useState(false)

  const mismatch = useOpen && openPw !== openPw2
  const sameAsOpen = useOpen && useOwner && !!ownerPw && ownerPw === openPw
  const valid = (useOpen || useOwner) && (!useOpen || (openPw && !mismatch)) && (!useOwner || ownerPw) && !sameAsOpen

  const push = (protect: SecurityOp['protect']) => {
    useEditStore.getState().pushOp({ kind: 'security', id: newOpId(), page: 0, protect })
  }

  const apply = () => {
    push({
      userPassword: useOpen ? openPw : '',
      ownerPassword: useOwner ? ownerPw : null,
      permissions: useOwner ? perms : ALL_PERMISSIONS,
    })
    notify(tr('保护设置将在保存时写入文件'))
    onClose()
  }

  const remove = () => {
    push(null)
    notify(tr('保存后文件将不再需要密码'))
    onClose()
  }

  const tryUnlock = async () => {
    const ok = await unlockWithOwnerPassword(unlockPw)
    setUnlockErr(!ok)
    if (ok) {
      // keep the current protection editable with the password just proven
      setOwnerPw(unlockPw)
      notify(tr('已使用权限密码解除限制'))
    }
  }

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="modal form-modal protect-modal"
        role="dialog"
        aria-modal="true"
        aria-label={tr('保护')}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            onClose()
          }
        }}
      >
        <div className="form-modal-head">
          <h2>{tr('保护')}</h2>
          <button className="tb-btn" aria-label={tr('关闭')} title={tr('关闭')} onClick={onClose}>
            <IconClose size={16} />
          </button>
        </div>
        <div className="form-body">
          <div className={`protect-status ${currentlyProtected ? 'on' : ''}`}>
            {currentlyProtected ? <IconLock size={16} /> : <IconLockOpen size={16} />}
            <span>
              {pending
                ? pending.protect
                  ? tr('保存时将使用新的密码保护')
                  : tr('保存时将移除密码保护')
                : encryption
                  ? tr(
                      '当前文档已加密（{0}{1}{2}）',
                      encryption.info.method,
                      encryption.info.needsPassword ? tr('，需要打开密码') : '',
                      encryption.info.restricted ? tr('，限制了部分权限') : '',
                    )
                  : tr('当前文档未加密')}
            </span>
          </div>

          {locked ? (
            <>
              <p className="form-note">{tr('此文档以打开密码打开，更改安全设置需要权限密码。')}</p>
              <div className="form-row">
                <input
                  className={`form-input ${unlockErr ? 'invalid' : ''}`}
                  type="password"
                  placeholder={tr('权限密码')}
                  aria-label={tr('权限密码')}
                  value={unlockPw}
                  autoFocus
                  onChange={(e) => setUnlockPw(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && unlockPw && void tryUnlock()}
                />
                <button className="btn" disabled={!unlockPw} onClick={() => void tryUnlock()}>
                  {tr('解除限制')}
                </button>
              </div>
              {unlockErr && <p className="pw-error">{tr('权限密码不正确。')}</p>}
            </>
          ) : (
            <>
              <label className="check-row">
                <input type="checkbox" checked={useOpen} onChange={(e) => setUseOpen(e.target.checked)} />
                <span>{tr('要求密码才能打开文档')}</span>
              </label>
              {useOpen && (
                <div className="form-row indent">
                  <input
                    className="form-input"
                    type="password"
                    placeholder={tr('打开密码')}
                    aria-label={tr('打开密码')}
                    value={openPw}
                    autoFocus
                    onChange={(e) => setOpenPw(e.target.value)}
                  />
                  <input
                    className={`form-input ${mismatch && openPw2 ? 'invalid' : ''}`}
                    type="password"
                    placeholder={tr('再次输入')}
                    aria-label={tr('确认打开密码')}
                    value={openPw2}
                    onChange={(e) => setOpenPw2(e.target.value)}
                  />
                </div>
              )}
              {mismatch && openPw2 && <p className="pw-error indent">{tr('两次输入的密码不一致。')}</p>}

              <label className="check-row">
                <input type="checkbox" checked={useOwner} onChange={(e) => setUseOwner(e.target.checked)} />
                <span>{tr('限制编辑和打印（需要权限密码才能更改）')}</span>
              </label>
              {useOwner && (
                <div className="indent">
                  <input
                    className="form-input"
                    type="password"
                    placeholder={tr('权限密码')}
                    aria-label={tr('权限密码')}
                    value={ownerPw}
                    onChange={(e) => setOwnerPw(e.target.value)}
                  />
                  {sameAsOpen && <p className="pw-error">{tr('权限密码不能与打开密码相同。')}</p>}
                  <div className="perm-grid">
                    {PERM_LABELS.map(([k, label]) => (
                      <label key={k} className="check-row small">
                        <input
                          type="checkbox"
                          checked={perms[k]}
                          disabled={k === 'printHigh' && !perms.print}
                          onChange={(e) => setPerms({ ...perms, [k]: e.target.checked })}
                        />
                        <span>
                          {tr('允许')}
                          {label}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <p className="form-note">
                {tr('使用 AES 256 位加密，兼容 Acrobat 与常见阅读器。请牢记密码，忘记后无法恢复。')}
              </p>
            </>
          )}
        </div>
        <div className="modal-actions">
          {!locked && currentlyProtected && (
            <button className="btn" onClick={remove}>
              {tr('移除保护')}
            </button>
          )}
          <span className="modal-spacer" />
          <button className="btn" onClick={onClose}>
            {tr('取消')}
          </button>
          {!locked && (
            <button className="btn primary" disabled={!valid} onClick={apply}>
              {tr('应用')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// Refresh interface-only catalogs when the display language changes.
onLocaleChange(() => {
  PERM_LABELS = createPermLabels()
})
