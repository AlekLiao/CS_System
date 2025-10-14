

document.addEventListener("DOMContentLoaded", () => {
  const logoutBtn = document.getElementById("logoutBtn");
  const rightFrame = document.getElementById("rightFrame");
  const dropdown = document.querySelector(".dropdown");
  const settingsBtn = document.getElementById("settingsBtn");

  // 登出 → 回到 login.html
  logoutBtn.addEventListener("click", () => {
    window.location.href = "login.html";
  });

  // 點擊「系統設置」切換選單
  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();                // 避免冒泡到 document 被立刻關閉
    dropdown.classList.toggle("open");
  });

  // 點擊頁面其他地方時關閉選單
  document.addEventListener("click", () => {
    dropdown.classList.remove("open");
  });

  // 用事件委派處理選單項目點擊
  document.addEventListener("click", (e) => {
    const item = e.target.closest(".dropdown-item");
    if (!item) return;

    const action = item.getAttribute("data-action");
    if (action === "user-manage") {
      renderUserManagePage();
    } else if (action === "role-manage") {
      alert("前往角色權限設置（可在此渲染頁面或跳轉）");
    }
  });



  /** 渲染：人員管理頁面 */
  function renderUserManagePage() {
    fetch("user-manage.html")
      .then(res => res.text())
      .then(html => {
        rightFrame.innerHTML = html;

        // 綁定事件
        const accountInput = document.getElementById("accountInput");
        document.getElementById("btnSearch").addEventListener("click", () => {
          alert(`搜尋賬號：${accountInput.value.trim() || "(未輸入)"}`);
        });
        document.getElementById("btnRole").addEventListener("click", () => {
          alert("打開角色管理面板");
        });

        const addOverlay = document.getElementById("addUserOverlay");
        document.getElementById("btnAdd").addEventListener("click", () => {
          addOverlay.style.display = "flex";
        });
        document.getElementById("clearContent").addEventListener("click", () => {
          //addOverlay.style.display = "none";
          alert("清除內容（未完成）");
        });
        document.getElementById("addUserCancel").addEventListener("click", () => {
          addOverlay.style.display = "none";
        });
        document.getElementById("addUserConfirm").addEventListener("click", () => {
          // 讀表單
          const name = document.getElementById("u_name").value.trim();
          const nick = document.getElementById("u_nick").value.trim();
          const pwd = document.getElementById("u_pwd").value.trim();
          const pwd2 = document.getElementById("u_pwd2").value.trim();
          const dept = document.getElementById("u_dept").value;
          const role = document.getElementById("u_role").value;
          const act = document.getElementById("u_active").value;
          const note = document.getElementById("u_note").value.trim();
          //const exp = (document.querySelector('input[name="u_experience"]:checked') || {}).value || "";
          const exp = document.getElementById("u_experience").value;

          // 簡單驗證
          if (!name) { alert("請填寫人員名稱"); return; }
          if (!pwd || !pwd2) { alert("請填寫密碼與確認密碼"); return; }
          if (pwd !== pwd2) { alert("兩次密碼不一致，請確認！"); return; }
          if (!dept) { alert("請選擇部門"); return; }
          if (!role) { alert("請選擇角色"); return; }
          if (!act) { alert("請選擇是否啟用"); return; }
          if (!exp) { alert("請選擇資歷（資深/資淺）"); return; }

          // 準備要寫入 Excel 的一列（中文欄名）
          const row = {
            "人員名稱": name,
            "暱稱": nick,
            "密碼": pwd,           // ⚠ 若不想輸出明文，可改成星號或留空
            "確認密碼": pwd2,       // 同上
            "部門": dept,
            "角色": role,
            "是否啟用": act,
            "資歷": exp,           // 資深 / 資淺
            "備註": note,
            "建立時間": new Date().toISOString().replace('T', ' ').slice(0, 19)
          };

          // 用 localStorage 暫存所有列，之後多次 Confirm 會累積成多列
          const KEY = "cs_member_rows";
          const rows = JSON.parse(localStorage.getItem(KEY) || "[]");
          rows.push(row);
          localStorage.setItem(KEY, JSON.stringify(rows));

          // 產生 Excel 並下載：cs_member.xlsx
          try {
            // 以欄位順序建立工作表
            const headers = ["人員名稱", "暱稱", "密碼", "確認密碼", "部門", "角色", "是否啟用", "資歷", "備註", "建立時間"];
            const ws = XLSX.utils.json_to_sheet(rows, { header: headers });
            // 自動調整欄寬（粗略 by 內容長度）
            const colWidths = headers.map(h => ({ wch: Math.max(h.length + 2, ...rows.map(r => String(r[h] || "").length + 2)) }));
            ws['!cols'] = colWidths;

            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, "成員清單");
            XLSX.writeFile(wb, "cs_member.xlsx");   // 直接觸發下載
            alert("已匯出到 Excel：cs_member.xlsx");

            // 關閉彈窗並可視需求清空表單
            document.getElementById("addUserOverlay").style.display = "none";
            // 如果要清空輸入欄位可取消以下註解
            // document.getElementById("u_name").value = "";
            // document.getElementById("u_nick").value = "";
            // document.getElementById("u_pwd").value = "";
            // document.getElementById("u_pwd2").value = "";
            // document.getElementById("u_dept").value = "";
            // document.getElementById("u_role").value = "";
            // document.getElementById("u_active").value = "";
            // document.querySelector('input[name="u_experience"][value="資淺"]').checked = true;
            // document.getElementById("u_note").value = "";
          } catch (e) {
            console.error(e);
            alert("匯出 Excel 失敗，請查看 Console。");
          }
        });
        addOverlay.addEventListener("click", (e) => {
          if (e.target === addOverlay) addOverlay.style.display = "none";
        });
      })
      .catch(err => console.error("載入 user-manage.html 失敗", err));
  }
});
